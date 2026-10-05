import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { searchEmails } from '../lib/emailSearch';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized — please log in via /auth/google' });
    return;
  }

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);

  if (!query || query.length > 200) {
    res.status(400).json({ error: 'q is required and must be no longer than 200 characters.' });
    return;
  }
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: 'page must be positive and limit must be between 1 and 100.' });
    return;
  }

  try {
    const result = await searchEmails(userId, query, page, limit);
    res.json({ ...result, page, limit, totalPages: Math.ceil(result.total / limit) });
  } catch (err) {
    console.error('[Search] Elasticsearch query failed:', err);
    res.status(503).json({ error: 'Email search is currently unavailable.' });
  }
});

export default router;
