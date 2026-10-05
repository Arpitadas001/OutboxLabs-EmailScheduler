import assert from 'node:assert/strict';
import test from 'node:test';
import Redis from 'ioredis';
import {
  releaseSenderSlot,
  reserveSenderSlot,
  senderWindowKey,
} from '../src/lib/rateLimiter';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

test('atomic sender reservations enforce hourly limit across concurrent callers', async () => {
  const senderId = `test-concurrency-${Date.now()}-${Math.random()}`;
  const now = Date.now();
  const counterKey = senderWindowKey(senderId, now);
  const slotKey = `ratelimit:slot:${senderId}`;

  try {
    await redis.connect();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        reserveSenderSlot(redis, senderId, 3, 0, now),
      ),
    );

    assert.equal(results.filter((result) => result.allowed).length, 3);
    assert.equal(results.filter((result) =>
      !result.allowed && result.reason === 'HOURLY_LIMIT',
    ).length, 9);
    assert.equal(Number(await redis.get(counterKey)), 3);
  } finally {
    await redis.del(counterKey, slotKey);
  }
});

test('minimum-delay check runs before hourly counter increment and failed send releases slot', async () => {
  const senderId = `test-min-delay-${Date.now()}-${Math.random()}`;
  const now = Date.now();
  const counterKey = senderWindowKey(senderId, now);
  const slotKey = `ratelimit:slot:${senderId}`;

  try {
    const first = await reserveSenderSlot(redis, senderId, 1, 1_000, now);
    const tooSoon = await reserveSenderSlot(redis, senderId, 1, 1_000, now + 500);

    assert.equal(first.allowed, true);
    assert.deepEqual(tooSoon, {
      allowed: false,
      reason: 'MIN_DELAY',
      retryAt: now + 1_000,
      window: Math.floor(now / 3_600_000),
    });
    assert.equal(Number(await redis.get(counterKey)), 1);

    if (!first.allowed) throw new Error('Expected the first sender reservation to succeed.');
    await releaseSenderSlot(redis, first.windowKey);
    assert.equal(Number(await redis.get(counterKey)), 0);
  } finally {
    await redis.del(counterKey, slotKey);
  }
});

test.after(async () => {
  await redis.quit();
});
