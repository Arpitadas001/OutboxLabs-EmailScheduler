import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

/**
 * BullMQ email queue.
 *
 * Architecture note:
 *   BullMQ requires its own dedicated ioredis connection — it MUST NOT share the
 *   connection used for express-session (node-redis) or general app queries.
 *   `createRedisConnection()` returns a fresh ioredis instance each time with
 *   `maxRetriesPerRequest: null`, which is required by BullMQ 5.
 *
 * Job naming convention:
 *   Every job is named `send-email`. The unique identity is provided by `jobId`,
 *   which is always `email-{emailId}` (hyphen, never colon — BullMQ disallows colons
 *   in jobIds because it uses colons as Redis key separators internally).
 *
 * Job options:
 *   - `removeOnComplete: { count: 1000 }` — keep the last 1 000 completed jobs
 *     for the Bull Board dashboard; discard older ones to avoid Redis bloat.
 *   - `removeOnFail: { count: 5000 }` — keep more failed jobs for post-mortem.
 *   - `attempts: 3` / `backoff: exponential` — allow up to 3 SMTP retries with
 *     exponential back-off (5 s, 10 s, 20 s).  The worker re-throws on failure
 *     so BullMQ schedules the retry automatically.
 */
export const emailQueueConnection = createRedisConnection();

export const emailQueue = new Queue('email', {
  connection: emailQueueConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail:    { count: 5000 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  },
});

emailQueue.on('error', (err) => {
  console.error('[Queue] BullMQ queue error:', err.message);
});
