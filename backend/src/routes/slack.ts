import { randomBytes } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/requireAuth';
import { encryptSlackToken } from '../lib/slack';
import { prisma } from '../lib/prisma';
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    slackOAuthState?: string;
  }
}

const router = Router();
const scopes = ['chat:write', 'im:write', 'users:read'].join(',');

function isConfigured(): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_REDIRECT_URI);
}

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { slackUserId: true, slackTeamId: true, slackToken: true },
    });
    res.json({
      configured: isConfigured(),
      connected: Boolean(user?.slackToken && user.slackUserId),
      teamId: user?.slackTeamId ?? null,
    });
  } catch (error) {
    console.error('[Slack] Status lookup failed:', error);
    res.status(500).json({ error: 'Could not load Slack connection status.' });
  }
});

router.get('/connect', requireAuth, (req: Request, res: Response) => {
  if (!isConfigured()) {
    res.status(503).json({ error: 'Slack OAuth is not configured on this server.' });
    return;
  }

  req.session.slackOAuthState = randomBytes(32).toString('hex');
  req.session.save((error) => {
    if (error) {
      console.error('[Slack] Could not save OAuth state:', error);
      res.status(500).json({ error: 'Could not start Slack authorization.' });
      return;
    }

    const authorizeUrl = new URL('https://slack.com/oauth/v2/authorize');
    authorizeUrl.searchParams.set('client_id', env.SLACK_CLIENT_ID!);
    authorizeUrl.searchParams.set('scope', scopes);
    authorizeUrl.searchParams.set('redirect_uri', env.SLACK_REDIRECT_URI!);
    authorizeUrl.searchParams.set('state', req.session.slackOAuthState!);
    res.redirect(authorizeUrl.toString());
  });
});

router.get('/callback', requireAuth, async (req: Request, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const savedState = req.session.slackOAuthState;
  delete req.session.slackOAuthState;

  if (!savedState || !state || savedState !== state || !code) {
    res.redirect(`${env.FRONTEND_URL}/?slack=authorization_failed`);
    return;
  }
  if (!isConfigured()) {
    res.redirect(`${env.FRONTEND_URL}/?slack=not_configured`);
    return;
  }

  try {
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID!,
        client_secret: env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: env.SLACK_REDIRECT_URI!,
      }),
    });
    if (!response.ok) throw new Error(`Slack OAuth returned HTTP ${response.status}.`);

    const result = await response.json() as {
      ok: boolean;
      error?: string;
      access_token?: string;
      authed_user?: { id?: string };
      team?: { id?: string };
    };
    if (!result.ok || !result.access_token || !result.authed_user?.id) {
      throw new Error(`Slack OAuth failed (${result.error ?? 'missing user token data'}).`);
    }

    await prisma.user.update({
      where: { id: req.session.userId },
      data: {
        slackToken: encryptSlackToken(result.access_token),
        slackUserId: result.authed_user.id,
        slackTeamId: result.team?.id ?? null,
      },
    });
    res.redirect(`${env.FRONTEND_URL}/?slack=connected`);
  } catch (error) {
    console.error('[Slack] OAuth callback failed:', error);
    res.redirect(`${env.FRONTEND_URL}/?slack=authorization_failed`);
  }
});

router.delete('/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    await prisma.user.update({
      where: { id: req.session.userId },
      data: { slackToken: null, slackUserId: null, slackTeamId: null },
    });
    res.status(204).end();
  } catch (error) {
    console.error('[Slack] Disconnect failed:', error);
    res.status(500).json({ error: 'Could not disconnect Slack.' });
  }
});

export default router;
