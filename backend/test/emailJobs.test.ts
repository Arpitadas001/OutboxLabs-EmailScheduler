import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueScheduledEmailJobs } from '../src/lib/emailJobs';

test('scheduled rows become delayed BullMQ jobs with the minimal required payload', async () => {
  const rows = [
    {
      id: 'email-1',
      jobId: 'email-email-1',
      scheduledAt: new Date('2026-10-05T10:00:10.000Z'),
    },
    {
      id: 'email-2',
      jobId: 'email-email-2',
      scheduledAt: new Date('2026-10-05T09:59:00.000Z'),
    },
  ];
  let receivedJobs: unknown;

  await enqueueScheduledEmailJobs(rows, async (jobs) => {
    receivedJobs = jobs;
  }, Date.parse('2026-10-05T10:00:00.000Z'));

  assert.deepEqual(receivedJobs, [
    {
      name: 'send-email',
      data: { emailId: 'email-1' },
      opts: { jobId: 'email-email-1', delay: 10_000 },
    },
    {
      name: 'send-email',
      data: { emailId: 'email-2' },
      opts: { jobId: 'email-email-2', delay: 0 },
    },
  ]);
});

test('persisted scheduled rows can be re-enqueued after an addBulk failure', async () => {
  const rows = [{
    id: 'email-recover',
    jobId: 'email-email-recover',
    scheduledAt: new Date('2026-10-05T10:01:00.000Z'),
  }];
  let attempts = 0;
  let recoveredJobs: unknown;

  await assert.rejects(
    enqueueScheduledEmailJobs(rows, async () => {
      attempts += 1;
      throw new Error('Redis unavailable');
    }),
    /Redis unavailable/,
  );

  await enqueueScheduledEmailJobs(rows, async (jobs) => {
    attempts += 1;
    recoveredJobs = jobs;
  }, Date.parse('2026-10-05T10:00:00.000Z'));

  assert.equal(attempts, 2);
  assert.deepEqual(recoveredJobs, [{
    name: 'send-email',
    data: { emailId: 'email-recover' },
    opts: { jobId: 'email-email-recover', delay: 60_000 },
  }]);
});
