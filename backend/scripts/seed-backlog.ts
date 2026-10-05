import { prisma } from '../src/lib/prisma';
import { emailQueue } from '../src/lib/queue';
import { env } from '../src/config/env';
import { enqueueScheduledEmailJobs } from '../src/lib/emailJobs';
import { indexCampaignEmails } from '../src/lib/emailSearch';

async function main(): Promise<void> {
  const requested = Number(process.argv[2] ?? 1000);
  if (!Number.isInteger(requested) || requested < 1000 || requested > 10_000) {
    throw new Error('Choose a backlog size from 1,000 to 10,000 emails.');
  }

  const [user, senders] = await Promise.all([
    prisma.user.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.sender.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  ]);
  if (!user) throw new Error('No existing User row is available; sign in with Google first.');
  if (senders.length === 0) throw new Error('No Sender rows are available; seed senders first.');

  const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const campaign = await prisma.$transaction(async (tx) => {
    const createdCampaign = await tx.campaign.create({
      data: {
        userId: user.id,
        name: `Backlog demo (${requested})`,
        subject: 'Backlog scheduler demonstration',
        body: 'Seeded future-dated message for queue throughput demonstration.',
        status: 'SCHEDULED',
        startAt,
        delaySeconds: 1,
        hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        totalEmails: requested,
      },
    });

    await tx.email.createMany({
      data: Array.from({ length: requested }, (_, index) => ({
        campaignId: createdCampaign.id,
        senderId: senders[index % senders.length].id,
        recipientEmail: `backlog-${createdCampaign.id}-${String(index + 1).padStart(5, '0')}@example.com`,
        status: 'SCHEDULED' as const,
        scheduledAt: new Date(startAt.getTime() + index * 1000),
        jobId: `backlog-placeholder-${createdCampaign.id}-${index}`,
      })),
    });

    const emails = await tx.email.findMany({
      where: { campaignId: createdCampaign.id },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });

    for (let offset = 0; offset < emails.length; offset += 100) {
      await Promise.all(
        emails.slice(offset, offset + 100).map((email) =>
          tx.email.update({
            where: { id: email.id },
            data: { jobId: `email-${email.id}` },
          }),
        ),
      );
    }
    return createdCampaign;
  });

  const emails = await prisma.email.findMany({
    where: { campaignId: campaign.id },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    select: { id: true, jobId: true, scheduledAt: true },
  });
  await enqueueScheduledEmailJobs(emails, (jobs) => emailQueue.addBulk(jobs));
  void indexCampaignEmails(campaign.id).catch((error: unknown) => {
    console.error(`[Backlog seed] Search indexing failed for campaign ${campaign.id}:`, error);
  });

  console.log(
    `Created ${emails.length} future-dated emails in campaign ${campaign.id}; first send is scheduled for ${startAt.toISOString()}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[Backlog seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([emailQueue.close(), prisma.$disconnect()]);
  });
