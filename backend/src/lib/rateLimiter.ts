import { Redis } from 'ioredis';

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_TTL_SECONDS = 3700;

export const RESERVE_SENDER_SLOT_SCRIPT = `
local nowMs = tonumber(ARGV[1])
local hourlyLimit = tonumber(ARGV[2])
local minDelayMs = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])

local lastReservation = redis.call('GET', KEYS[2])
if lastReservation then
  local nextAllowedAt = tonumber(lastReservation) + minDelayMs
  if nowMs < nextAllowedAt then
    return {1, nextAllowedAt}
  end
end

local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= hourlyLimit then
  local windowStart = math.floor(nowMs / 3600000) * 3600000
  return {2, windowStart + 3600000}
end

if count == 0 then
  redis.call('SET', KEYS[1], 1, 'EX', ttlSeconds)
else
  redis.call('INCR', KEYS[1])
end
redis.call('SET', KEYS[2], nowMs, 'EX', ttlSeconds * 2)
return {0, count + 1}
`;

export const RELEASE_SENDER_SLOT_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;

export type SlotReservation =
  | { allowed: true; windowKey: string; count: number }
  | {
      allowed: false;
      reason: 'MIN_DELAY' | 'HOURLY_LIMIT';
      retryAt: number;
      window: number;
    };

export function senderWindowKey(senderId: string, nowMs: number): string {
  return `ratelimit:${senderId}:${Math.floor(nowMs / HOUR_MS)}`;
}

export async function reserveSenderSlot(
  redis: Redis,
  senderId: string,
  hourlyLimit: number,
  minDelayMs: number,
  nowMs = Date.now(),
): Promise<SlotReservation> {
  const counterKey = senderWindowKey(senderId, nowMs);
  const window = Math.floor(nowMs / HOUR_MS);
  const windowStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const result = await redis.eval(
    RESERVE_SENDER_SLOT_SCRIPT,
    2,
    counterKey,
    `ratelimit:slot:${senderId}`,
    nowMs,
    hourlyLimit,
    minDelayMs,
    WINDOW_TTL_SECONDS,
  ) as [number, number];

  if (result[0] === 1) {
    return { allowed: false, reason: 'MIN_DELAY', retryAt: result[1], window };
  }
  if (result[0] === 2) {
    return {
      allowed: false,
      reason: 'HOURLY_LIMIT',
      retryAt: windowStart + HOUR_MS,
      window,
    };
  }

  return { allowed: true, windowKey: counterKey, count: result[1] };
}

export async function releaseSenderSlot(redis: Redis, windowKey: string): Promise<void> {
  await redis.eval(RELEASE_SENDER_SLOT_SCRIPT, 1, windowKey);
}

export function getDeterministicWindowOffset(
  emailOrderIndex: number,
  minDelayMs: number,
): number {
  return Math.max(0, emailOrderIndex) * minDelayMs;
}
