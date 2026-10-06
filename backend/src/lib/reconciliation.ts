import { enqueueScheduledEmailJobs, ScheduledEmailJob } from './emailJobs';

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export interface ReconciliationResult {
  reclaimed: number;
  scheduled: number;
  immediate: number;
  delayed: number;
}

export async function reconcileScheduledEmails(
  reclaimStale: (before: Date) => Promise<number>,
  findScheduled: () => Promise<ScheduledEmailJob[]>,
  addBulk: Parameters<typeof enqueueScheduledEmailJobs>[1],
  now = Date.now(),
): Promise<ReconciliationResult> {
  const reclaimed = await reclaimStale(new Date(now - STALE_THRESHOLD_MS));
  const scheduled = await findScheduled();

  if (scheduled.length > 0) {
    await enqueueScheduledEmailJobs(scheduled, addBulk, now);
  }

  const immediate = scheduled.filter((email) => email.scheduledAt.getTime() <= now).length;
  return {
    reclaimed,
    scheduled: scheduled.length,
    immediate,
    delayed: scheduled.length - immediate,
  };
}
