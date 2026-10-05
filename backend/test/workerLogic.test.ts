import assert from 'node:assert/strict';
import test from 'node:test';
import { claimScheduledEmail, hasRetriesRemaining } from '../src/worker/emailWorkerLogic';

test('only one concurrent worker can claim a SCHEDULED email', async () => {
  const status = { value: 'SCHEDULED' };
  const updateMany = async (args: {
    where: { id: string; status: 'SCHEDULED' };
    data: {
      status: 'PROCESSING';
      processingStartedAt: Date;
      attemptCount: { increment: 1 };
    };
  }) => {
    assert.deepEqual(args.where, { id: 'email-1', status: 'SCHEDULED' });
    assert.equal(args.data.status, 'PROCESSING');
    assert.equal(args.data.attemptCount.increment, 1);

    if (status.value !== args.where.status) return { count: 0 };
    status.value = args.data.status;
    return { count: 1 };
  };

  const claimedAt = new Date('2026-10-05T10:00:00.000Z');
  const [first, second] = await Promise.all([
    claimScheduledEmail(updateMany, 'email-1', claimedAt),
    claimScheduledEmail(updateMany, 'email-1', claimedAt),
  ]);

  assert.deepEqual([first, second].sort(), [false, true]);
  assert.equal(status.value, 'PROCESSING');
});

test('retry remains eligible until the configured final attempt', () => {
  assert.equal(hasRetriesRemaining({ attemptsMade: 0, opts: { attempts: 3 } }), true);
  assert.equal(hasRetriesRemaining({ attemptsMade: 1, opts: { attempts: 3 } }), true);
  assert.equal(hasRetriesRemaining({ attemptsMade: 2, opts: { attempts: 3 } }), false);
  assert.equal(hasRetriesRemaining({ attemptsMade: 0, opts: {} }), false);
});
