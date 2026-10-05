import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { prisma } from './prisma';
import { redis } from './redis';

const SLACK_API = 'https://slack.com/api';

function encryptionKey(): Buffer {
  return createHash('sha256').update(env.ENCRYPTION_KEY).digest();
}

export function encryptSlackToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSlackToken(value: string): string {
  const [iv, authTag, ciphertext] = value.split('.');
  if (!iv || !authTag || !ciphertext) {
    throw new Error('Stored Slack token has an invalid encrypted format.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function slackRequest<T>(method: string, token: string, body: object): Promise<T> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Slack ${method} returned HTTP ${response.status}.`);
  }
  const result = await response.json() as T & { ok?: boolean; error?: string };
  if (result.ok === false) {
    throw new Error(`Slack ${method} failed (${result.error ?? 'unknown_error'}).`);
  }
  return result;
}

export async function notifySenderRateLimit(
  userId: string,
  senderId: string,
  senderName: string,
  currentWindow: number,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { slackToken: true, slackUserId: true },
  });
  await notifyConnectedSlackUser(user, senderId, senderName, currentWindow);
}

export async function notifyConnectedSlackUser(
  user: { slackToken: string | null; slackUserId: string | null } | null,
  senderId: string,
  senderName: string,
  currentWindow: number,
): Promise<void> {
  if (!user?.slackToken || !user.slackUserId) return;

  const notificationKey = `ratelimit:notification:${senderId}:${currentWindow}`;
  const claimed = await redis.set(notificationKey, '1', 'EX', 3700, 'NX');
  if (claimed !== 'OK') return;

  try {
    const token = decryptSlackToken(user.slackToken);
    const conversation = await slackRequest<{ channel: { id: string } }>(
      'conversations.open',
      token,
      { users: user.slackUserId },
    );
    await slackRequest<{ ts: string }>('chat.postMessage', token, {
      channel: conversation.channel.id,
      text: `Sender *${senderName}* reached its hourly email limit. Remaining emails are being deferred to the next hour window.`,
      mrkdwn: true,
    });
  } catch (error) {
    await redis.del(notificationKey);
    throw error;
  }
}
