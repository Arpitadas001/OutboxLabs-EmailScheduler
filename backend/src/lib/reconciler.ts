import { prisma } from './prisma';
import { emailQueue } from './queue';

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

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function reconcileOnStartup(): Promise<void> {
  console.log('[Reconciler] Starting startup reconciliation…');

  // ── Step 1: Reclaim stale PROCESSING rows ────────────────────────────────
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const { count: reclaimed } = await prisma.email.updateMany({
    where: {
      status: 'PROCESSING',
      processingStartedAt: { lt: staleThreshold },
    },
    data: {
      status: 'SCHEDULED',
      processingStartedAt: null,
    },
  });

  if (reclaimed > 0) {
    console.log(`[Reconciler] ♻️  Reclaimed ${reclaimed} stale PROCESSING email(s) → SCHEDULED`);
  }

  // ── Step 2: Re-queue all SCHEDULED emails ────────────────────────────────
  const scheduled = await prisma.email.findMany({
    where: { status: 'SCHEDULED' },
    select: { id: true, jobId: true, scheduledAt: true },
    orderBy: { scheduledAt: 'asc' },
  });

  if (scheduled.length === 0) {
    console.log('[Reconciler] ✅ No SCHEDULED emails to re-queue. All done.');
    return;
  }

  const now = Date.now();

  const jobs = scheduled.map((email) => ({
    name: 'send-email' as const,
    data: { emailId: email.id },
    opts: {
      jobId: email.jobId,                                        // ID-01: deduplication
      delay: Math.max(0, email.scheduledAt.getTime() - now),    // delay from now
    },
  }));

  // BullMQ addBulk is atomic — duplicate jobIds are silently ignored.
  await emailQueue.addBulk(jobs);

  const immediate = jobs.filter((j) => (j.opts.delay ?? 0) === 0).length;
  const delayed   = jobs.length - immediate;

  console.log(
    `[Reconciler] ✅ Re-queued ${jobs.length} email(s) into BullMQ` +
      ` (${immediate} immediate, ${delayed} delayed).`,
  );
}
