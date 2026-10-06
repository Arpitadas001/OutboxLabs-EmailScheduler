interface EmailClaimArgs {
  where: { id: string; status: 'SCHEDULED' };
  data: {
    status: 'PROCESSING';
    processingStartedAt: Date;
    attemptCount: { increment: 1 };
  };
}

interface ProcessingEmailUpdateArgs {
  where: { id: string; status: 'PROCESSING' };
  data: { status: 'SCHEDULED'; processingStartedAt: null };
}

export type EmailStatusForWorker =
  | 'SCHEDULED'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'CANCELLED';

export function isTerminalEmailStatus(status: EmailStatusForWorker): boolean {
  return status === 'SENT' || status === 'FAILED' || status === 'CANCELLED';
}

export async function claimScheduledEmail(
  updateMany: (args: EmailClaimArgs) => Promise<{ count: number }>,
  emailId: string,
  claimedAt = new Date(),
): Promise<boolean> {
  const { count } = await updateMany({
    where: { id: emailId, status: 'SCHEDULED' },
    data: {
      status: 'PROCESSING',
      processingStartedAt: claimedAt,
      attemptCount: { increment: 1 },
    },
  });

  return count === 1;
}

export async function releaseProcessingEmail(
  updateMany: (args: ProcessingEmailUpdateArgs) => Promise<{ count: number }>,
  emailId: string,
): Promise<void> {
  const result = await updateMany({
    where: { id: emailId, status: 'PROCESSING' },
    data: { status: 'SCHEDULED', processingStartedAt: null },
  });

  if (result.count !== 1) {
    throw new Error(`Email ${emailId} could not be released from PROCESSING.`);
  }
}

export async function rescheduleProcessingEmail(
  updateMany: (args: ProcessingEmailUpdateArgs) => Promise<{ count: number }>,
  moveToDelayed: (timestamp: number, token: string | undefined) => Promise<unknown>,
  emailId: string,
  retryAt: number,
  token: string | undefined,
): Promise<void> {
  await releaseProcessingEmail(updateMany, emailId);
  await moveToDelayed(retryAt, token);
}

export interface EmailJobAttempt {
  attemptsMade: number;
  opts: { attempts?: number };
}

export function hasRetriesRemaining(job: EmailJobAttempt): boolean {
  return job.attemptsMade + 1 < (job.opts.attempts ?? 1);
}

export function getOriginalEmailOrderIndex(
  scheduledAt: Date,
  campaignStartAt: Date,
  delaySeconds: number,
): number {
  if (delaySeconds > 0) {
    return Math.max(0, Math.round(
      (scheduledAt.getTime() - campaignStartAt.getTime()) / (delaySeconds * 1000),
    ));
  }

  return 0;
}
