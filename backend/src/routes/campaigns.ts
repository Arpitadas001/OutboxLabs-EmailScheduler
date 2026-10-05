import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { emailQueue } from '../lib/queue';
import { requireAuth } from '../middleware/requireAuth';
import { z } from 'zod';

/**
 * Campaign routes.
 *
 * POST /campaigns    — create a campaign and bulk-create Email rows.
 *   - Emails are assigned to senders round-robin (sender index = emailIndex % senderCount).
 *   - Each Email gets a BullMQ-compatible jobId of "email-{id}" (hyphen, not colon).
 *   - scheduledAt = startAt + emailIndex * delaySeconds.
 *
 * GET /campaigns     — list all campaigns owned by the current user.
 *
 * GET /campaigns/:id/emails — paginated email rows for a campaign
 *   (used by the dashboard detail view / Phase 5 reconciler).
 */

const router = Router();

// ── Validation ────────────────────────────────────────────────────────────────

const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  subject: z.string().min(1).max(998), // RFC 5321 header line limit
  body: z.string().min(1),
  emails: z.array(z.string().email()).min(1, 'At least one valid email is required'),
  startAt: z.string().datetime({ message: 'startAt must be an ISO 8601 datetime' }),
  delaySeconds: z.number().int().min(0).max(3600),
  hourlyLimit: z.number().int().min(1).max(1000),
});

type CreateCampaignBody = z.infer<typeof createCampaignSchema>;

// ── POST /campaigns ───────────────────────────────────────────────────────────

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { name, subject, body, emails, startAt, delaySeconds, hourlyLimit } =
    parsed.data as CreateCampaignBody;

  try {
    // Fetch all senders for round-robin assignment
    const senders = await prisma.sender.findMany({ select: { id: true } });
    if (senders.length === 0) {
      res.status(500).json({
        error: 'No senders available — run `npm run prisma:seed` to seed Ethereal accounts.',
      });
      return;
    }

    const startDate = new Date(startAt);

    // Create the Campaign and all Email rows in a single transaction
    // We need the email IDs after creation to build BullMQ jobs.
    // Run the DB work in a transaction, then addBulk outside (addBulk is not
    // transactional with Prisma, and that is fine — the reconciler on the next
    // restart will re-queue any SCHEDULED emails not yet in the queue).
    const campaign = await prisma.$transaction(async (tx) => {
      const newCampaign = await tx.campaign.create({
        data: {
          userId: req.session.userId!,
          name,
          subject,
          body,
          status: 'SCHEDULED',
          startAt: startDate,
          delaySeconds,
          hourlyLimit,
          totalEmails: emails.length,
        },
      });

      // Bulk-create Email rows.
      // We must create them one by one in the transaction so we can reference
      // the generated IDs to build the jobId.  createMany does not return IDs
      // in PostgreSQL via Prisma, so we use a loop + createMany trick:
      // First insert all rows without jobId, then update each with its own id.
      // Alternative: generate cuid IDs client-side. We use createMany + update.

      // Generate email data objects
      const emailData = emails.map((recipientEmail, idx) => ({
        campaignId: newCampaign.id,
        senderId: senders[idx % senders.length].id,
        recipientEmail,
        status: 'SCHEDULED' as const,
        scheduledAt: new Date(startDate.getTime() + idx * delaySeconds * 1000),
        jobId: `email-placeholder-${idx}`, // temporary; updated below
      }));

      // createMany is faster than N individual creates
      await tx.email.createMany({ data: emailData });

      // Retrieve the created rows (we need their real IDs to set jobId)
      const created = await tx.email.findMany({
        where: { campaignId: newCampaign.id },
        select: { id: true },
        orderBy: { scheduledAt: 'asc' },
      });

      // Update each row's jobId to "email-{id}" (BullMQ restriction: no colons)
      await Promise.all(
        created.map((row) =>
          tx.email.update({
            where: { id: row.id },
            data: { jobId: `email-${row.id}` },
          }),
        ),
      );

      return newCampaign;
    });

    // ── Enqueue BullMQ jobs ────────────────────────────────────────────────
    // Fetch the email rows we just created (we need scheduledAt + jobId).
    const emailRows = await prisma.email.findMany({
      where: { campaignId: campaign.id },
      select: { id: true, jobId: true, scheduledAt: true },
      orderBy: { scheduledAt: 'asc' },
    });

    const now = Date.now();
    const bullJobs = emailRows.map((row) => ({
      name: 'send-email' as const,
      data: { emailId: row.id },
      opts: {
        jobId: row.jobId,
        delay: Math.max(0, row.scheduledAt.getTime() - now),
      },
    }));

    await emailQueue.addBulk(bullJobs);
    console.log(`[Campaigns] Enqueued ${bullJobs.length} job(s) for campaign ${campaign.id}`);

    res.status(201).json(campaign);
  } catch (err) {
    console.error('[Campaigns] POST /campaigns error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /campaigns ────────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { userId: req.session.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        subject: true,
        status: true,
        startAt: true,
        totalEmails: true,
        sentCount: true,
        failedCount: true,
        delaySeconds: true,
        hourlyLimit: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(campaigns);
  } catch (err) {
    console.error('[Campaigns] GET /campaigns error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /campaigns/:id/emails ─────────────────────────────────────────────────

router.get('/:id/emails', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  // Page + limit via query params — defaults to first 50
  const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '50', 10)));
  const skip = (page - 1) * limit;

  try {
    // Verify ownership
    const campaign = await prisma.campaign.findFirst({
      where: { id, userId: req.session.userId },
      select: { id: true, totalEmails: true },
    });

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const [emails, total] = await Promise.all([
      prisma.email.findMany({
        where: { campaignId: id },
        orderBy: { scheduledAt: 'asc' },
        skip,
        take: limit,
        select: {
          id: true,
          recipientEmail: true,
          status: true,
          scheduledAt: true,
          sentAt: true,
          failedAt: true,
          errorMessage: true,
          attemptCount: true,
        },
      }),
      prisma.email.count({ where: { campaignId: id } }),
    ]);

    res.json({ emails, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Campaigns] GET /campaigns/:id/emails error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
