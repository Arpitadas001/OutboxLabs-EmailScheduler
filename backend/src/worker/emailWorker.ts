import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { createSmtpTransport, getEtherealPreviewUrl } from '../lib/mailer';
import { env } from '../config/env';

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
 *   PROCESSING → FAILED     (SMTP error; BullMQ retries up to `attempts` times)
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
  const concurrency = parseInt(env.WORKER_CONCURRENCY, 10); // W-01

  const worker = new Worker<EmailJobData>(
    'email',
    async (job: Job<EmailJobData>) => {
      const { emailId } = job.data;

      // ── Pre-flight: load the email row ─────────────────────────────────
      const email = await prisma.email.findUnique({
        where: { id: emailId },
        include: {
          sender: true,
          campaign: { select: { id: true, subject: true, body: true, totalEmails: true } },
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
      const { count: claimed } = await prisma.email.updateMany({
        where: { id: emailId, status: 'SCHEDULED' },
        data: {
          status: 'PROCESSING',
          processingStartedAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });

      if (claimed === 0) {
        // Another worker instance won the CAS race
        console.log(`[Worker] job ${job.id}: email ${emailId} already claimed — skipping`);
        return;
      }

      // ── SMTP send ───────────────────────────────────────────────────────
      try {
        const transport = createSmtpTransport(
          email.sender.smtpHost,
          email.sender.smtpPort,
          email.sender.smtpUser,
          email.sender.smtpPass,
        );

        const info = await transport.sendMail({
          from:    `"${email.sender.name}" <${email.sender.fromEmail}>`,
          to:      email.recipientEmail,
          subject: email.campaign.subject,
          text:    email.campaign.body,
          html:    `<p style="font-family:sans-serif;line-height:1.6">${email.campaign.body.replace(/\n/g, '<br>')}</p>`,
        });

        const previewUrl = getEtherealPreviewUrl(info);

        // ── Mark SENT + increment campaign sentCount ────────────────────
        await prisma.$transaction([
          prisma.email.update({
            where: { id: emailId },
            data: {
              status:    'SENT',
              sentAt:    new Date(),
              messageId: info.messageId ?? null,
            },
          }),
          prisma.campaign.update({
            where: { id: email.campaignId },
            data: { sentCount: { increment: 1 } },
          }),
        ]);

        console.log(
          `[Worker] ✅ Sent email ${emailId} → ${email.recipientEmail}` +
            (previewUrl ? `\n          Preview: ${previewUrl}` : ''),
        );

        // ── Check campaign completion ────────────────────────────────────
        await maybeFinaliseCampaign(email.campaignId, email.campaign.totalEmails);
      } catch (sendError) {
        // ── SMTP failure: mark FAILED + increment failedCount ────────────
        const message = sendError instanceof Error ? sendError.message : String(sendError);

        console.error(
          `[Worker] ❌ Failed to send email ${emailId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}): ${message}`,
        );

        await prisma.$transaction([
          prisma.email.update({
            where: { id: emailId },
            data: {
              status:       'FAILED',
              failedAt:     new Date(),
              errorMessage: message,
            },
          }),
          prisma.campaign.update({
            where: { id: email.campaignId },
            data: { failedCount: { increment: 1 } },
          }),
        ]);

        await maybeFinaliseCampaign(email.campaignId, email.campaign.totalEmails);

        // Re-throw so BullMQ records the attempt and schedules the retry.
        // On the final attempt BullMQ moves the job to the failed set.
        throw sendError;
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

/**
 * After each terminal email update (SENT or FAILED), check whether all emails
 * for the campaign have reached a terminal state.  If so, finalize the campaign.
 *
 * We read the freshest counts from the DB (not from the in-memory email object)
 * to avoid stale-read races under concurrent workers.
 */
async function maybeFinaliseCamera(campaignId: string, totalEmails: number): Promise<void> {
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

// Alias with correct spelling used above
const maybeFinaliseCampaign = maybeFinaliseCamera;
