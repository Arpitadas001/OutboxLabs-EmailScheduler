import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth } from '../middleware/requireAuth';
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

/**
 * Google OAuth 2.0 flow — no Passport, using google-auth-library directly.
 *
 * Flow:
 *   1. GET /auth/google   → build the Google consent URL and redirect the browser.
 *   2. GET /auth/google/callback → Google posts back a `code` query param.
 *      Backend exchanges the code for tokens, fetches the user profile,
 *      upserts the User row in PostgreSQL, and stores `userId` in the session.
 *   3. GET /auth/me       → returns the current user profile from the DB
 *      (session holds only the userId — we fetch the rest fresh each time).
 *   4. GET /auth/logout   → destroys the session, redirects to /login.
 *
 * Why not Passport?  google-auth-library is already installed and gives us
 * the same capability with less magic.  The flow is transparent and easy to
 * explain in an interview.
 */

const router = Router();

const oAuth2Client = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_CALLBACK_URL,
);

// ─── 1. Initiate OAuth ────────────────────────────────────────────────────────

router.get('/google', (_req: Request, res: Response) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email'],
    prompt: 'select_account',
  });
  res.redirect(url);
});

// ─── 2. OAuth Callback ───────────────────────────────────────────────────────

router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query as { code?: string; error?: string };

  if (error || !code) {
    console.error('[Auth] Google OAuth error:', error);
    return res.redirect(`${env.FRONTEND_URL}/login?error=oauth_denied`);
  }

  try {
    // Exchange authorization code for tokens
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Fetch user profile from Google's userinfo endpoint
    const userInfoRes = await oAuth2Client.request<{
      sub: string;
      name: string;
      email: string;
      picture?: string;
    }>({ url: 'https://www.googleapis.com/oauth2/v3/userinfo' });

    const profile = userInfoRes.data;

    // Upsert the user in PostgreSQL:
    // - First login: creates the row.
    // - Subsequent logins: updates name + picture (they can change in Google).
    const user = await prisma.user.upsert({
      where: { googleId: profile.sub },
      create: {
        googleId: profile.sub,
        email: profile.email,
        name: profile.name,
        picture: profile.picture ?? null,
      },
      update: {
        name: profile.name,
        picture: profile.picture ?? null,
      },
    });

    // Store only the DB userId in the session — not the whole profile.
    // This keeps the session payload minimal and avoids stale-data bugs.
    req.session.userId = user.id;
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('[Auth] Session save error:', saveErr);
        return res.redirect(`${env.FRONTEND_URL}/login?error=session_error`);
      }
      res.redirect(`${env.FRONTEND_URL}/`);
    });
  } catch (err) {
    console.error('[Auth] Callback error:', err);
    res.redirect(`${env.FRONTEND_URL}/login?error=server_error`);
  }
});

// ─── 3. Current user profile ─────────────────────────────────────────────────

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        picture: true,
        slackUserId: true,
        slackTeamId: true,
        createdAt: true,
      },
    });

    if (!user) {
      // Session references a deleted user — clear it
      req.session.destroy(() => {});
      res.status(401).json({ error: 'User not found — session cleared' });
      return;
    }

    res.json(user);
  } catch (err) {
    console.error('[Auth] /me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── 4. Logout ───────────────────────────────────────────────────────────────

router.get('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Logout error:', err);
    }
    // Clear the session cookie on the client
    res.clearCookie('connect.sid');
    res.redirect(`${env.FRONTEND_URL}/login`);
  });
});

export default router;
