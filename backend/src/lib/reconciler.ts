import { prisma } from './prisma';
import { emailQueue } from './queue';
import { reconcileScheduledEmails } from './reconciliation';

/**
 * Startup reconciler — runs once when the backend process starts.
 *
 * Two-step process:
 *
 * Step 1 — Stale-PROCESSING reclaim (W-03):
 *   A crashed worker may have left emails stuck in PROCESSING status with no
 *   job in the BullMQ queue.  Any PROCESSING row whose `processingStartedAt`
 *   is older than STALE_THRESHOLD_MS is reset to SCHEDULED so it can be
 *   re-queued in Step 2.
 *
 * Step 2 — Re-queue SCHEDULED emails (P-03, S-01):
 *   All emails with status=SCHEDULED are added to BullMQ using `addBulk`.
 *   The delay for each job is: max(0, scheduledAt - now).
 *   - If scheduledAt is in the past the job fires immediately (delay=0).
 *   - If the jobId already exists in BullMQ it is silently ignored (BullMQ
 *     deduplication via jobId — satisfies ID-01).
 *
 * This guarantees that future scheduled emails survive backend restarts,
 * even if Redis data was flushed, as long as the PostgreSQL rows remain.
 */

export async function reconcileOnStartup(): Promise<void> {
  console.log('[Reconciler] Starting startup reconciliation…');

  const result = await reconcileScheduledEmails(
    async (staleThreshold) => {
      const { count } = await prisma.email.updateMany({
        where: {
          status: 'PROCESSING',
          processingStartedAt: { lt: staleThreshold },
        },
        data: {
          status: 'SCHEDULED',
          processingStartedAt: null,
        },
      });
      return count;
    },
    () => prisma.email.findMany({
      where: { status: 'SCHEDULED' },
      select: { id: true, jobId: true, scheduledAt: true },
      orderBy: { scheduledAt: 'asc' },
    }),
    (jobs) => emailQueue.addBulk(jobs),
  );

  if (result.reclaimed > 0) {
    console.log(`[Reconciler] ♻️  Reclaimed ${result.reclaimed} stale PROCESSING email(s) → SCHEDULED`);
  }

  if (result.scheduled === 0) {
    console.log('[Reconciler] ✅ No SCHEDULED emails to re-queue. All done.');
    return;
  }

  console.log(
    `[Reconciler] ✅ Re-queued ${result.scheduled} email(s) into BullMQ` +
      ` (${result.immediate} immediate, ${result.delayed} delayed).`,
  );
}
