import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { createClient } from 'redis';
import RedisStore from 'connect-redis';
import { env } from './config/env';
import authRouter from './routes/auth';
import campaignsRouter from './routes/campaigns';
import emailsRouter from './routes/emails';
import csvRouter from './routes/csv';
import searchRouter from './routes/search';
import queueDashboardRouter from './routes/queueDashboard';
import { startEmailWorker } from './worker/emailWorker';
import { reconcileOnStartup } from './lib/reconciler';
import { ensureEmailIndex, reindexAllEmails } from './lib/emailSearch';
import slackRouter from './routes/slack';

/**
 * Express application bootstrap.
 *
 * Session strategy:
 *   - express-session stores a signed, httpOnly cookie (`connect.sid`) in the browser.
 *   - The session data (just `userId`) lives in Redis via connect-redis.
 *   - Redis AOF persistence means sessions survive Redis restarts.
 *   - `resave: false` + `saveUninitialized: false` follow the recommended
 *     express-session settings — only sessions that have been modified are saved.
 *
 * CORS:
 *   - Allowing the Vite dev server origin with `credentials: true` so the browser
 *     sends the session cookie on cross-origin requests.
 */

async function bootstrap() {
  const app = express();
  app.set('trust proxy', 1);

  // ── Redis session store ──────────────────────────────────────────────────────
  // We use the node-redis v4 client (not ioredis) here because connect-redis@7
  // targets node-redis v4 out of the box.
  const redisClient = createClient({ url: env.REDIS_URL });
  redisClient.on('error', (err) => console.error('[Redis] client error:', err.message));
  await redisClient.connect();

  const sessionStore = new RedisStore({ client: redisClient });

  // ── Middleware ───────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true, // required so the browser sends session cookies
    }),
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(
    session({
      store: sessionStore,
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: (req) => ({
        httpOnly: true, // prevents XSS from reading the cookie
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: 'lax',
      }),
    }),
  );

  // Vercel routes API requests with the original /api prefix. Keep root mounts
  // as aliases for existing local clients and integrations.
  const apiRouter = express.Router();
  apiRouter.use('/auth', authRouter);
  apiRouter.use('/campaigns', campaignsRouter);
  apiRouter.use('/emails', emailsRouter);
  apiRouter.use('/csv', csvRouter);
  apiRouter.use('/search', searchRouter);
  apiRouter.use('/slack', slackRouter);
  apiRouter.use('/admin/queues', queueDashboardRouter);

  apiRouter.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', message: 'Backend is up' });
  });

  apiRouter.get('/health/dependencies', async (_req, res) => {
    const results: Record<string, string> = {};

    // PostgreSQL check via Prisma
    try {
      const { PrismaClient } = await import('@prisma/client');
      const testPrisma = new PrismaClient();
      await testPrisma.$queryRaw`SELECT 1`;
      await testPrisma.$disconnect();
      results.postgres = 'ok';
    } catch (e) {
      results.postgres = e instanceof Error ? e.message : 'unreachable';
    }

    // Redis check via redisClient already connected
    try {
      const pong = await redisClient.ping();
      results.redis = pong === 'PONG' ? 'ok' : `unexpected: ${pong}`;
    } catch (e) {
      results.redis = e instanceof Error ? e.message : 'unreachable';
    }

    // Elasticsearch check
    try {
      const { env: envConfig } = await import('./config/env');
      const esRes = await fetch(`${envConfig.ELASTICSEARCH_URL.replace(/\/$/, '')}/_cluster/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (esRes.ok) {
        const data = await esRes.json() as { status?: string };
        results.elasticsearch = data.status === 'green' || data.status === 'yellow' ? 'ok' : `status: ${data.status}`;
      } else {
        results.elasticsearch = `HTTP ${esRes.status}`;
      }
    } catch (e) {
      results.elasticsearch = e instanceof Error ? e.message : 'unreachable';
    }

    const httpStatus = Object.values(results).every((v) => v === 'ok') ? 200 : 503;
    res.status(httpStatus).json(results);
  });

  app.use('/api', apiRouter);
  app.use(apiRouter);

  // ── Start ────────────────────────────────────────────────────────────────────
  app.listen(env.PORT, () => {
    console.log(`🚀 Server listening on port ${env.PORT}`);
  });

  // ── Worker + Reconciler (Phase 5) ────────────────────────────────────────────
  // Start the BullMQ worker in the same process as the HTTP server.
  // The worker runs independently via its own event loop callbacks.
  // In production you would split this into a separate process/container,
  // but for this project running both together keeps the setup simple.
  startEmailWorker();

  // Run the startup reconciler AFTER the worker is listening so that
  // any jobs re-queued immediately (delay=0) will be picked up right away.
  await reconcileOnStartup();

  void ensureEmailIndex()
    .then(reindexAllEmails)
    .then(() => console.log('[Elasticsearch] Email index is ready and synchronized.'))
    .catch((err: unknown) => console.error('[Elasticsearch] Startup indexing failed:', err));
}

bootstrap().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
