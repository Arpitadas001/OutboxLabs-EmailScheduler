interface EmailClaimArgs {
  where: { id: string; status: 'SCHEDULED' };
  data: {
    status: 'PROCESSING';
    processingStartedAt: Date;
    attemptCount: { increment: 1 };
  };
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
