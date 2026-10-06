import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptSlackToken,
  encryptSlackToken,
  notifyConnectedSlackUser,
} from '../src/lib/slack';

test('encrypted Slack credentials round-trip without exposing the stored token', () => {
  const token = 'xoxb-test-token-never-log';
  const encrypted = encryptSlackToken(token);
  const [iv, authTag, ciphertext] = encrypted.split('.');
  const tamperedTagBytes = Buffer.from(authTag, 'base64url');
  tamperedTagBytes[0] ^= 1;
  const tamperedTag = tamperedTagBytes.toString('base64url');

  assert.notEqual(encrypted, token);
  assert.equal(decryptSlackToken(encrypted), token);
  assert.throws(() => decryptSlackToken(`${iv}.${tamperedTag}.${ciphertext}`));
});

test('rate-limit notification is a safe no-op when Slack is disconnected', async () => {
  await assert.doesNotReject(
    notifyConnectedSlackUser(null, 'sender-1', 'Test sender', 1),
  );
  await assert.doesNotReject(
    notifyConnectedSlackUser({ slackToken: null, slackUserId: null }, 'sender-1', 'Test sender', 1),
  );
});
