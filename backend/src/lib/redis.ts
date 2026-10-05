import { Redis } from 'ioredis';
import { env } from '../config/env';

/**
 * Shared ioredis client used for:
 *  - connect-redis session store
 *  - BullMQ queue/worker connections
 *  - Rate-limit Lua scripts
 *
 * We export a factory so BullMQ can get isolated connections (it
 * requires separate connections from the app-level client).
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('[Redis] connection error:', err.message);
});

/** Returns a fresh ioredis instance for BullMQ (which needs its own connections). */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
