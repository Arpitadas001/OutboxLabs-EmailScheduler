import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { enqueueScheduledEmailJobs } from '../src/lib/emailJobs';
import { emailQueue, emailQueueConnection } from '../src/lib/queue';

const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 3 * 60_000;

async function main(): Promise<void> {
  const csvPath = path.resolve(__dirname, '../../samples/test.csv');
  const csv = (await readFile(csvPath, 'utf8')).replace(/^\uFEFF/, '');
  const [header, ...emailLines] = csv.split(/\r?\n/).filter((line) => line.trim());
  const recipients = emailLines.map((line) => line.trim());

  if (header?.trim().toLowerCase() !== 'email' || recipients.length !== 3) {
    throw new Error(`${csvPath} must have an email header and exactly three lead rows.`);
  }

  const [user, senders] = await Promise.all([
    prisma.user.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.sender.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  ]);

  if (!user) throw new Error('No existing User row is available for the E2E campaign.');
  if (senders.length === 0) throw new Error('No existing Sender rows are available.');

  const startAt = new Date(Date.now() + 60_000);
  const campaign = await prisma.$transaction(async (tx) => {
    const createdCampaign = await tx.campaign.create({
      data: {
        userId: user.id,
        name: 'E2E check',
        subject: 'E2E send check',
        body: 'Manual end-to-end email delivery verification.',
        status: 'SCHEDULED',
        startAt,
        delaySeconds: 5,
        hourlyLimit: 100,
        totalEmails: recipients.length,
      },
    });

    await tx.email.createMany({
      data: recipients.map((recipientEmail, index) => ({
        campaignId: createdCampaign.id,
        senderId: senders[index % senders.length].id,
        recipientEmail,
        status: 'SCHEDULED' as const,
        scheduledAt: new Date(startAt.getTime() + index * 5_000),
        jobId: `e2e-placeholder-${createdCampaign.id}-${index}`,
      })),
    });

    const createdEmails = await tx.email.findMany({
      where: { campaignId: createdCampaign.id },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      select: { id: true, scheduledAt: true },
    });

    await Promise.all(
      createdEmails.map((email) =>
        tx.email.update({
          where: { id: email.id },
          data: { jobId: `email-${email.id}` },
        }),
      ),
    );

    return createdCampaign;
  });

  const scheduledEmails = await prisma.email.findMany({
    where: { campaignId: campaign.id },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    select: { id: true, jobId: true, scheduledAt: true },
  });

  await enqueueScheduledEmailJobs(scheduledEmails, (jobs) => emailQueue.addBulk(jobs));
  console.log(
    `Created campaign ${campaign.id}; queued ${scheduledEmails.length} emails for ${startAt.toISOString()}.`,
  );

  const deadline = Date.now() + TIMEOUT_MS;
  let finalEmails = await readEmailStatuses(campaign.id);

  while (Date.now() < deadline) {
    printEmailStatuses(finalEmails);

    if (finalEmails.every((email) => email.status === 'SENT' || email.status === 'FAILED')) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    finalEmails = await readEmailStatuses(campaign.id);
  }

  printEmailStatuses(finalEmails);

  const passed =
    finalEmails.length === 3 &&
    finalEmails.every((email) => email.status === 'SENT' && email.attemptCount === 1) &&
    finalEmails.every((email) => email.messageId !== null) &&
    new Set(finalEmails.map((email) => email.messageId)).size === 3;

  if (passed) {
    console.log('E2E SEND CHECK PASSED: all 3 emails reached SENT on exactly one worker attempt.');
    return;
  }

  console.error('E2E SEND CHECK FAILED: not all 3 emails were sent exactly once.');
  for (const email of finalEmails) {
    const job = await emailQueue.getJob(email.jobId);
    const state = job ? await job.getState() : 'missing';
    console.error(
      `Queue job ${email.jobId}: state=${state}, attemptsMade=${job?.attemptsMade ?? 'n/a'}, failedReason=${job?.failedReason ?? 'n/a'}`,
    );
  }
  process.exitCode = 1;
}

async function readEmailStatuses(campaignId: string) {
  return prisma.email.findMany({
    where: { campaignId },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      jobId: true,
      recipientEmail: true,
      status: true,
      attemptCount: true,
      sentAt: true,
      messageId: true,
      errorMessage: true,
    },
  });
}

function printEmailStatuses(
  emails: Awaited<ReturnType<typeof readEmailStatuses>>,
): void {
  console.log('Email status poll:');
  for (const email of emails) {
    console.log(
      JSON.stringify({
        recipientEmail: email.recipientEmail,
        status: email.status,
        attemptCount: email.attemptCount,
        sentAt: email.sentAt?.toISOString() ?? null,
        messageId: email.messageId,
        errorMessage: email.errorMessage,
      }),
    );
  }
}

async function run(): Promise<void> {
  let exitCode = 0;
  try {
    await main();
  } catch (error: unknown) {
    console.error('E2E SEND CHECK ERROR:', error);
    exitCode = 1;
  }

  for (const [name, close] of [
    ['BullMQ queue', () => emailQueue.close()],
    ['BullMQ Redis connection', () => emailQueueConnection.quit()],
    ['Prisma client', () => prisma.$disconnect()],
  ] as const) {
    try {
      await close();
    } catch (error) {
      console.error(`Could not close ${name}:`, error);
      exitCode = 1;
    }
  }

  process.exitCode = exitCode;
}

void run();
