import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileScheduledEmails } from '../src/lib/reconciliation';

test('reclaims stale processing rows before addBulk re-queues scheduled rows', async () => {
  const now = Date.parse('2026-10-05T10:00:00.000Z');
  const order: string[] = [];
  let staleThreshold: Date | undefined;
  let queuedJobs: unknown;

  const result = await reconcileScheduledEmails(
    async (before) => {
      order.push('reclaim');
      staleThreshold = before;
      return 2;
    },
    async () => {
      order.push('find-scheduled');
      return [{
        id: 'email-future',
        jobId: 'email-email-future',
        scheduledAt: new Date(now + 30_000),
      }];
    },
    async (jobs) => {
      order.push('addBulk');
      queuedJobs = jobs;
    },
    now,
  );

  assert.equal(staleThreshold?.toISOString(), '2026-10-05T09:55:00.000Z');
  assert.deepEqual(order, ['reclaim', 'find-scheduled', 'addBulk']);
  assert.deepEqual(queuedJobs, [{
    name: 'send-email',
    data: { emailId: 'email-future' },
    opts: { jobId: 'email-email-future', delay: 30_000 },
  }]);
  assert.deepEqual(result, { reclaimed: 2, scheduled: 1, immediate: 0, delayed: 1 });
});

test('empty reconciliation avoids an unnecessary addBulk call', async () => {
  const now = Date.parse('2026-10-05T10:00:00.000Z');
  let queuedCount = 0;

  const result = await reconcileScheduledEmails(
    async () => 0,
    async () => [],
    async () => {
      queuedCount += 1;
    },
    now,
  );

  assert.equal(queuedCount, 0);
  assert.deepEqual(result, { reclaimed: 0, scheduled: 0, immediate: 0, delayed: 0 });
});

test('a queue failure is surfaced so persisted scheduled rows can be reconciled later', async () => {
  await assert.rejects(
    reconcileScheduledEmails(
      async () => 0,
      async () => [{
        id: 'email-recover',
        jobId: 'email-email-recover',
        scheduledAt: new Date('2026-10-05T10:01:00.000Z'),
      }],
      async () => {
        throw new Error('Redis unavailable');
      },
      Date.parse('2026-10-05T10:00:00.000Z'),
    ),
    /Redis unavailable/,
  );
});
