import { DelayedError, Worker, Job } from 'bullmq';
import { createRedisConnection, redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { createSmtpTransport, getEtherealPreviewUrl } from '../lib/mailer';
import { env } from '../config/env';
import {
  getDeterministicWindowOffset,
  reserveSenderSlot,
  releaseSenderSlot,
} from '../lib/rateLimiter';
import { indexEmail } from '../lib/emailSearch';
import { notifySenderRateLimit } from '../lib/slack';
import {
  claimScheduledEmail,
  getOriginalEmailOrderIndex,
  hasRetriesRemaining,
} from './emailWorkerLogic';

/**
 * Email Worker — BullMQ worker that processes `send-email` jobs.
 *
 * ── Idempotency (two layers) ──────────────────────────────────────────────────
 *
 * Layer 1 — BullMQ jobId deduplication (ID-01):
 *   Every job has jobId = `email-{emailId}`.  BullMQ refuses to add a job whose
 *   jobId already exists in the queue, so duplicate enqueues are silently
 *   dropped at the queue level.
 *
 * Layer 2 — Atomic DB CAS SCHEDULED → PROCESSING (ID-02):
 *   Inside the worker we attempt:
 *     UPDATE email SET status='PROCESSING', processingStartedAt=NOW()
 *     WHERE id=? AND status='SCHEDULED'
 *   If `count === 0` (another worker beat us, or the email is already SENT/FAILED)
 *   we return early.  This makes the worker safe under concurrent concurrency.
 *
 * ── Status transitions ────────────────────────────────────────────────────────
 *
 *   SCHEDULED → PROCESSING  (CAS in worker, before SMTP attempt)
 *   PROCESSING → SENT       (successful SMTP send)
 *   PROCESSING → SCHEDULED  (SMTP error while BullMQ retries remain)
 *   PROCESSING → FAILED     (SMTP error after the final BullMQ attempt)
 *
 * ── Campaign completion ───────────────────────────────────────────────────────
 *
 *   After each SENT/FAILED update the worker checks whether
 *   `sentCount + failedCount >= totalEmails`; if so the campaign status is
 *   set to COMPLETED or FAILED accordingly.
 */

interface EmailJobData {
  emailId: string;
}

export function startEmailWorker(): Worker<EmailJobData> {
  const concurrency = env.WORKER_CONCURRENCY;

  const worker = new Worker<EmailJobData>(
    'email',
    async (job: Job<EmailJobData>) => {
      const { emailId } = job.data;

      // ── Pre-flight: load the email row ─────────────────────────────────
      const email = await prisma.email.findUnique({
        where: { id: emailId },
        include: {
          sender: true,
          campaign: {
            select: {
              id: true,
              subject: true,
              body: true,
              totalEmails: true,
              startAt: true,
              delaySeconds: true,
              hourlyLimit: true,
              userId: true,
            },
          },
        },
      });

      if (!email) {
        // Row was deleted — nothing to do
        console.warn(`[Worker] job ${job.id}: email ${emailId} not found — skipping`);
        return;
      }

      // Layer 2a: fast-exit if already terminal (idempotency guard)
      if (email.status === 'SENT') {
        console.log(`[Worker] job ${job.id}: email ${emailId} already SENT — no-op`);
        return;
      }
      if (email.status === 'CANCELLED' || email.status === 'FAILED') {
        console.log(`[Worker] job ${job.id}: email ${emailId} status=${email.status} — no-op`);
        return;
      }

      // ── Layer 2b: Atomic CAS SCHEDULED → PROCESSING ────────────────────
      const claimed = await claimScheduledEmail(
        (args) => prisma.email.updateMany(args),
        emailId,
      );

      if (!claimed) {
        // Another worker instance won the CAS race
        console.log(`[Worker] job ${job.id}: email ${emailId} already claimed — skipping`);
        return;
      }

      const minDelayMs = Math.max(
        env.MIN_DELAY_BETWEEN_EMAILS_MS,
        email.campaign.delaySeconds * 1000,
      );
      const hourlyLimit = email.campaign.hourlyLimit || env.MAX_EMAILS_PER_HOUR_PER_SENDER;
      let reservation;

      try {
        reservation = await reserveSenderSlot(
          redis,
          email.senderId,
          hourlyLimit,
          minDelayMs,
        );
      } catch (rateLimitError) {
        await releaseEmailForRetry(emailId);
        throw rateLimitError;
      }

      if (!reservation.allowed) {
        if (reservation.reason === 'HOURLY_LIMIT') {
          await notifySenderRateLimit(
            email.campaign.userId,
            email.senderId,
            email.sender.name,
            reservation.window,
          ).catch((error: unknown) => {
            console.error(`[Worker] Slack rate-limit notification failed for sender ${email.senderId}:`, error);
          });
        }

        const plannedOrderIndex = getOriginalEmailOrderIndex(
          email.scheduledAt,
          email.campaign.startAt,
          email.campaign.delaySeconds,
        );
        const orderIndex = email.campaign.delaySeconds > 0
          ? plannedOrderIndex
          : await prisma.email.count({
              where: {
                campaignId: email.campaignId,
                OR: [
                  { scheduledAt: { lt: email.scheduledAt } },
                  { scheduledAt: email.scheduledAt, id: { lt: email.id } },
                ],
              },
            });
        const deterministicOffset = getDeterministicWindowOffset(orderIndex, minDelayMs);
        const retryAt = reservation.retryAt + (
          reservation.reason === 'HOURLY_LIMIT' ? deterministicOffset : 0
        );

        console.info(
          `[Worker] Sender ${email.senderId} deferred email ${emailId} (${reservation.reason}) until ${new Date(retryAt).toISOString()}.`,
        );
        await releaseEmailForRetry(emailId);
        await job.moveToDelayed(retryAt, job.token);
        throw new DelayedError();
      }

      // Keep SMTP errors separate from database persistence errors. A failed
      // SENT update must never turn a successfully accepted SMTP message into
      // a terminal FAILED email.
      let info;
      try {
        const transport = createSmtpTransport(
          email.sender.smtpHost,
          email.sender.smtpPort,
          email.sender.smtpUser,
          email.sender.smtpPass,
        );

        info = await transport.sendMail({
          from:    `"${email.sender.name}" <${email.sender.fromEmail}>`,
          to:      email.recipientEmail,
          subject: email.campaign.subject,
          text:    email.campaign.body,
          html:    `<p style="font-family:sans-serif;line-height:1.6">${email.campaign.body.replace(/\n/g, '<br>')}</p>`,
        });
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError);
        console.error(
          `[Worker] ❌ Failed to send email ${emailId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}): ${message}`,
        );
        try {
          await releaseSenderSlot(redis, reservation.windowKey);
        } catch (releaseError) {
          console.error(`[Worker] Could not release reserved hourly slot for ${emailId}:`, releaseError);
        }

        if (hasRetriesRemaining(job)) {
          try {
            const released = await prisma.email.updateMany({
              where: { id: emailId, status: 'PROCESSING' },
              data: { status: 'SCHEDULED', processingStartedAt: null },
            });
            if (released.count !== 1) {
              console.warn(`[Worker] Email ${emailId} could not be released for its BullMQ retry.`);
            }
          } catch (recoveryError) {
            console.error(
              `[Worker] Could not release email ${emailId} for its BullMQ retry:`,
              recoveryError,
            );
          }
        } else {
          const markedFailed = await prisma.$transaction(async (tx) => {
            const result = await tx.email.updateMany({
              where: { id: emailId, status: 'PROCESSING' },
              data: {
                status: 'FAILED',
                failedAt: new Date(),
                errorMessage: message,
                processingStartedAt: null,
              },
            });

            if (result.count === 1) {
              await tx.campaign.update({
                where: { id: email.campaignId },
                data: { failedCount: { increment: 1 } },
              });
            }

            return result.count === 1;
          });

          if (markedFailed) {
            await indexEmail(emailId).catch((err: unknown) => {
              console.error(`[Worker] Could not index failed email ${emailId}:`, err);
            });
            await maybeFinaliseCampaign(email.campaignId, email.campaign.totalEmails);
          }
        }

        throw sendError;
      }

      const previewUrl = getEtherealPreviewUrl(info);
      let markedSent: boolean;

      try {
        markedSent = await prisma.$transaction(async (tx) => {
          const result = await tx.email.updateMany({
            where: { id: emailId, status: 'PROCESSING' },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              messageId: info.messageId ?? null,
              processingStartedAt: null,
              errorMessage: null,
            },
          });

          if (result.count === 1) {
            await tx.campaign.update({
              where: { id: email.campaignId },
              data: { sentCount: { increment: 1 } },
            });
          }

          return result.count === 1;
        });
      } catch (persistenceError) {
        console.error(
          `[Worker] SMTP accepted email ${emailId}, but database persistence of SENT failed:`,
          persistenceError,
        );

        try {
          await prisma.email.updateMany({
            where: { id: emailId, status: 'PROCESSING' },
            data: { status: 'SCHEDULED', processingStartedAt: null },
          });
        } catch (recoveryError) {
          console.error(
            `[Worker] Could not release email ${emailId} after SENT persistence failed; stale-PROCESSING recovery may reclaim it:`,
            recoveryError,
          );
        }

        throw persistenceError;
      }

      if (!markedSent) {
        console.warn(`[Worker] Email ${emailId} was no longer PROCESSING after SMTP accepted it.`);
      } else {
        await indexEmail(emailId).catch((err: unknown) => {
          console.error(`[Worker] Could not index sent email ${emailId}:`, err);
        });
        console.log(
          `[Worker] ✅ Sent email ${emailId} → ${email.recipientEmail}` +
            (previewUrl ? `\n          Preview: ${previewUrl}` : ''),
        );
        await maybeFinaliseCampaign(email.campaignId, email.campaign.totalEmails);
      }
    },
    {
      connection: createRedisConnection(), // dedicated connection for the worker
      concurrency,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[Worker] job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] job ${job?.id} failed (all retries exhausted): ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error('[Worker] worker-level error:', err.message);
  });

  console.log(`🔧 Email worker started (concurrency: ${concurrency})`);
  return worker;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function releaseEmailForRetry(emailId: string): Promise<void> {
  const released = await prisma.email.updateMany({
    where: { id: emailId, status: 'PROCESSING' },
    data: { status: 'SCHEDULED', processingStartedAt: null },
  });

  if (released.count !== 1) {
    throw new Error(`Email ${emailId} could not be released from PROCESSING.`);
  }
}

/**
 * After each terminal email update (SENT or FAILED), check whether all emails
 * for the campaign have reached a terminal state.  If so, finalize the campaign.
 *
 * We read the freshest counts from the DB (not from the in-memory email object)
 * to avoid stale-read races under concurrent workers.
 */
async function maybeFinaliseCampaign(campaignId: string, totalEmails: number): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { sentCount: true, failedCount: true, status: true },
  });

  if (!campaign) return;
  if (campaign.status === 'COMPLETED' || campaign.status === 'FAILED') return; // already final

  const done = campaign.sentCount + campaign.failedCount;
  if (done < totalEmails) return; // still in progress

  const finalStatus = campaign.failedCount === 0 ? 'COMPLETED' : campaign.sentCount === 0 ? 'FAILED' : 'COMPLETED';

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: finalStatus },
  });

  console.log(`[Worker] Campaign ${campaignId} → ${finalStatus} (sent: ${campaign.sentCount}, failed: ${campaign.failedCount})`);
}
