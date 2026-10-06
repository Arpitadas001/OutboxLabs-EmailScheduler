import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimScheduledEmail,
  hasRetriesRemaining,
  isTerminalEmailStatus,
  releaseProcessingEmail,
  rescheduleProcessingEmail,
} from '../src/worker/emailWorkerLogic';

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

test('SMTP retry releases PROCESSING back to SCHEDULED before retrying', async () => {
  let status = 'PROCESSING';
  await releaseProcessingEmail(async (args) => {
    assert.deepEqual(args, {
      where: { id: 'email-retry', status: 'PROCESSING' },
      data: { status: 'SCHEDULED', processingStartedAt: null },
    });
    if (status !== args.where.status) return { count: 0 };
    status = args.data.status;
    return { count: 1 };
  }, 'email-retry');

  assert.equal(status, 'SCHEDULED');
});

test('rate-limited email is released and moved to the requested delayed timestamp', async () => {
  let status = 'PROCESSING';
  let movedTo: { timestamp: number; token: string | undefined } | undefined;

  await rescheduleProcessingEmail(
    async (args) => {
      assert.deepEqual(args.where, { id: 'email-deferred', status: 'PROCESSING' });
      status = args.data.status;
      return { count: 1 };
    },
    async (timestamp, token) => {
      movedTo = { timestamp, token };
    },
    'email-deferred',
    1_798_000_000_000,
    'lock-token',
  );

  assert.equal(status, 'SCHEDULED');
  assert.deepEqual(movedTo, { timestamp: 1_798_000_000_000, token: 'lock-token' });
});

test('a failed release prevents moving the BullMQ job', async () => {
  let moveAttempted = false;
  await assert.rejects(
    rescheduleProcessingEmail(
      async () => ({ count: 0 }),
      async () => {
        moveAttempted = true;
      },
      'email-not-processing',
      Date.now() + 60_000,
      'lock-token',
    ),
    /could not be released from PROCESSING/,
  );
  assert.equal(moveAttempted, false);
});

test('terminal email states are idempotent no-ops', () => {
  assert.equal(isTerminalEmailStatus('SENT'), true);
  assert.equal(isTerminalEmailStatus('FAILED'), true);
  assert.equal(isTerminalEmailStatus('CANCELLED'), true);
  assert.equal(isTerminalEmailStatus('SCHEDULED'), false);
  assert.equal(isTerminalEmailStatus('PROCESSING'), false);
});
