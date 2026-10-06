import { Router, Request, Response } from 'express';
import { EmailStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/requireAuth';

export interface EmailListResponse {
  emails: unknown[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type EmailListService = (
  userId: string,
  view: 'scheduled' | 'sent',
  page: number,
  limit: number,
) => Promise<EmailListResponse>;

async function listUserEmails(
  userId: string,
  view: 'scheduled' | 'sent',
  page: number,
  limit: number,
): Promise<EmailListResponse> {
  const statuses: EmailStatus[] = view === 'scheduled'
    ? ['SCHEDULED', 'PROCESSING']
    : ['SENT', 'FAILED'];
  const where: Prisma.EmailWhereInput = {
    status: { in: statuses },
    campaign: { userId },
  };

  const [emails, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy: view === 'scheduled'
        ? [{ scheduledAt: 'asc' }, { id: 'asc' }]
        : [{ sentAt: 'desc' }, { failedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
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
        campaign: { select: { subject: true, name: true } },
      },
    }),
    prisma.email.count({ where }),
  ]);

  return { emails, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export function createEmailsRouter(listEmails: EmailListService = listUserEmails): Router {
  const emailRouter = Router();

  emailRouter.get('/', requireAuth, async (req: Request, res: Response) => {
    const view = req.query.view;
    if (view !== 'scheduled' && view !== 'sent') {
      res.status(400).json({ error: 'view must be either "scheduled" or "sent".' });
      return;
    }

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      res.status(400).json({ error: 'page must be positive and limit must be between 1 and 100.' });
      return;
    }

    try {
      res.json(await listEmails(req.session.userId!, view, page, limit));
    } catch (err) {
      console.error(`[Emails] GET /emails?view=${view} failed:`, err);
      res.status(500).json({ error: 'Failed to load emails.' });
    }
  });

  return emailRouter;
}

export default createEmailsRouter();
