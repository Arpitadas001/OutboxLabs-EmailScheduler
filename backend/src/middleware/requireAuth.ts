import { Request, Response, NextFunction } from 'express';

/**
 * requireAuth — protect any route that needs a logged-in user.
 *
 * How it works:
 *   express-session stores `userId` on `req.session` after Google OAuth.
 *   If `userId` is absent the session is anonymous → respond 401 so the
 *   frontend can redirect to /login.
 *
 * Interview note: we store only the DB userId in the session (not the full
 * user object) to keep the session payload tiny and avoid stale-data bugs.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Unauthorized — please log in via /auth/google' });
    return;
  }
  next();
}
