/**
 * prisma/seed.ts — Phase 3 seed: create 3 Ethereal SMTP sender accounts.
 *
 * How it works:
 *   - nodemailer.createTestAccount() calls the Ethereal API to provision a
 *     fresh test SMTP inbox. Each call returns unique credentials.
 *   - We upsert by fromEmail so re-running the seed is safe (idempotent).
 *   - A small delay between calls avoids Ethereal returning the same account
 *     when called in rapid succession.
 *   - In Phase 5 the worker uses these senders, assigned round-robin.
 *
 * Run via:
 *   npm run prisma:seed
 */

import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

/** Small sleep to avoid Ethereal returning duplicate accounts in rapid succession */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('🌱 Seeding Sender accounts via Ethereal...');

  const SENDER_COUNT = 3;
  const seenEmails = new Set<string>();

  for (let i = 0; i < SENDER_COUNT; i++) {
    // Wait between calls so Ethereal allocates distinct accounts
    if (i > 0) await sleep(1500);

    const account = await nodemailer.createTestAccount();

    if (seenEmails.has(account.user)) {
      // Ethereal returned the same account again — use a stable suffix to make it unique
      console.log(`  ⚠️  Duplicate Ethereal account (${account.user}), creating synthetic variant ${i + 1}`);
      const syntheticEmail = `sender-${i + 1}@ethereal.email`;
      await prisma.sender.upsert({
        where: { fromEmail: syntheticEmail },
        create: {
          name: `Outbox Sender ${i + 1}`,
          fromEmail: syntheticEmail,
          smtpHost: account.smtp.host,
          smtpPort: account.smtp.port,
          smtpUser: account.user,   // real SMTP user for auth
          smtpPass: account.pass,
        },
        update: {
          smtpUser: account.user,
          smtpPass: account.pass,
        },
      });
      seenEmails.add(syntheticEmail);
    } else {
      seenEmails.add(account.user);
      await prisma.sender.upsert({
        where: { fromEmail: account.user },
        create: {
          name: `Outbox Sender ${i + 1}`,
          fromEmail: account.user,
          smtpHost: account.smtp.host,
          smtpPort: account.smtp.port,
          smtpUser: account.user,
          smtpPass: account.pass,
        },
        update: {
          smtpPass: account.pass, // refresh in case credentials rotated
        },
      });
      console.log(`  ✓ Created Ethereal account: ${account.user}`);
    }
  }

  const allSenders = await prisma.sender.findMany({ select: { id: true, fromEmail: true, name: true } });
  console.log(`\n✅ Sender table now has ${allSenders.length} sender(s):`);
  allSenders.forEach((s) => console.log(`   - [${s.id.slice(0, 8)}...] ${s.name} <${s.fromEmail}>`));
  console.log('   Ethereal previews: https://ethereal.email\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
