export interface ScheduledEmailJob {
  id: string;
  jobId: string;
  scheduledAt: Date;
}

export interface EmailQueueJob {
  name: 'send-email';
  data: { emailId: string };
  opts: { jobId: string; delay: number };
}

export function buildScheduledEmailJobs(
  emails: ScheduledEmailJob[],
  now = Date.now(),
): EmailQueueJob[] {
  return emails.map((email) => ({
    name: 'send-email',
    data: { emailId: email.id },
    opts: {
      jobId: email.jobId,
      delay: Math.max(0, email.scheduledAt.getTime() - now),
    },
  }));
}

export function enqueueScheduledEmailJobs(
  emails: ScheduledEmailJob[],
  addBulk: (jobs: EmailQueueJob[]) => Promise<unknown>,
  now = Date.now(),
): Promise<unknown> {
  return addBulk(buildScheduledEmailJobs(emails, now));
}
