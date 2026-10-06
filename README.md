# OutboxLabs Email Scheduler

A small full-stack email scheduling demo: React/Vite dashboard, Express API, PostgreSQL/Prisma records, BullMQ delayed jobs on Redis, Ethereal SMTP, Elasticsearch search, and optional Slack notifications.

## Requirements

- Node.js 20 or newer
- Docker Desktop / Docker Compose
- Google OAuth credentials for browser login
- Optional Slack app credentials and an HTTPS tunnel for live Slack OAuth

## Local setup

1. Copy `.env.example` to `.env` and fill in your local values. Never commit `.env`.
2. Install dependencies and start PostgreSQL, Redis, and Elasticsearch:

   ```sh
   npm install
   npm run docker:up
   ```

3. Generate the Prisma client and apply the project's migrations:

   ```sh
   npm run prisma:generate --workspace backend
   npm run prisma:migrate --workspace backend
   ```

4. Seed Ethereal SMTP senders only if the database does not already have them:

   ```sh
   npm run prisma:seed --workspace backend
   ```

   This command creates or refreshes sender records. Do not run it against an environment where existing sender credentials must remain unchanged.

5. Start the backend API/worker and Vite frontend:

   ```sh
   npm run dev
   ```

   The frontend listens on `http://localhost:3000`; the backend listens on `http://localhost:3001`. Vite is configured with `strictPort`, so a second frontend cannot silently occupy the API port. Run the dev command only once.

## Vercel deployment

The root [`vercel.json`](./vercel.json) configures two services: `backend` (Express) and
`frontend` (Vite). Public `/api` requests go to the backend with the `/api` prefix
preserved; all other paths go to the frontend. The backend serves both `/api/...`
routes and the original root routes for local compatibility. The Vite development
server proxies `/api` to the local backend.

Configure the backend's database, Redis, Elasticsearch, session/encryption, Google
OAuth, and other required environment variables in Vercel. Configure `FRONTEND_URL`
to the deployed frontend origin, and register
`https://<deployment-domain>/api/auth/google/callback` as the Google OAuth callback.
If Slack OAuth is enabled, use
`https://<deployment-domain>/api/slack/callback` for its redirect URI. The frontend
uses the relative `/api` path by default; if setting `VITE_API_URL`, include the
`/api` prefix (for example, `https://<deployment-domain>/api`).

The frontend makes browser requests through the public `/api` rewrite, so it does
not need a service binding. PostgreSQL, Redis, and Elasticsearch are external
infrastructure dependencies, not Vercel application services, and must be
provisioned separately. The backend also starts a BullMQ worker and startup
reconciler in its process; verify that the selected Vercel Express runtime can keep
that worker available for scheduled delivery, or run the worker in a persistent
worker host before relying on Vercel for email delivery.

## Environment configuration

| Variable | Purpose |
|---|---|
| `PORT` | Express API port (normally `3001`) |
| `FRONTEND_URL` | Browser origin used by CORS and OAuth redirects (normally `http://localhost:3000`) |
| `SESSION_SECRET` | Express session signing secret; use a random secret of at least 32 characters |
| `ENCRYPTION_KEY` | Key material used to encrypt stored Slack tokens; use a private random value of at least 32 characters |
| `DATABASE_URL` | PostgreSQL connection URL |
| `REDIS_URL` | Redis connection URL shared by BullMQ and sessions |
| `ELASTICSEARCH_URL` | Elasticsearch base URL |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Google OAuth; callback must match the URI registered with Google |
| `WORKER_CONCURRENCY` | Number of BullMQ jobs a worker processes concurrently |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | Default minimum spacing between send reservations for one sender |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Default fixed-window per-sender limit; a campaign's compose-form `hourlyLimit` takes precedence |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI` | Optional Slack OAuth app credentials and callback URL |

`MIN_DELAY_BETWEEN_EMAILS_MS` defaults to the prior `MIN_SEND_DELAY_MS` value when that legacy key exists; otherwise the application validation fallback is 1000 ms. The new key is shown in `.env.example`. The campaign's `delaySeconds` is also honored: the effective minimum is the larger of the campaign delay and the environment delay.

### Google OAuth

Register `http://localhost:3001/auth/google/callback` as an authorized redirect URI. Login is a full-page redirect to Google; the application stores only the database user ID in a Redis-backed session.

### Slack OAuth (optional)

Without Slack credentials, the app reports that Slack is not configured and rate-limit notifications safely do nothing. For local live OAuth, expose the backend over HTTPS (for example, `ngrok http 3001`), register the resulting `/slack/callback` URL in the Slack app, and set the three Slack variables above. Grant bot scopes `chat:write`, `im:write`, and `users:read`. The dashboard supports connect, disconnect, and reconnect. Tokens are encrypted with AES-256-GCM before storage. Rate-limit notifications open a DM with the connected user and name the sender.

## Scheduling and delivery

- `POST /campaigns` creates a campaign and its PostgreSQL email rows in one transaction, assigning existing senders round-robin.
- Each row is queued as a BullMQ delayed job named `send-email`, with ID `email-{emailId}` and payload `{ emailId }`. Campaign submission and startup reconciliation use the same bulk enqueue helper.
- Redis runs with AOF persistence and `maxmemory-policy noeviction`. On startup, stale `PROCESSING` records older than five minutes are reclaimed, then `SCHEDULED` rows are reconciled into BullMQ with `addBulk`. BullMQ job IDs suppress duplicate enqueues when a job is already present.
- Worker concurrency is configured by `WORKER_CONCURRENCY`. Each job uses an atomic PostgreSQL compare-and-swap from `SCHEDULED` to `PROCESSING`.
- Before SMTP, one Redis Lua script checks the fixed-hour sender counter and minimum-delay slot atomically. The Redis key is `ratelimit:{senderId}:{hourWindow}`. The minimum-delay check runs first, so a rejected spacing check does not consume an hourly slot. SMTP failures decrement the reserved hourly counter.
- When a sender is at its limit, the job is moved (not failed or dropped) to the next fixed-hour window. A deterministic offset derived from the campaign's planned email order spreads the backlog. With a zero campaign delay, a stable scheduled-time/ID ordering is used because the current database schema has no separate original-order column.
- Hourly quota counts successful reservations; an SMTP failure releases its count. The last-send key tracks reservation time, so minimum spacing is enforced between concurrent send starts, not between SMTP delivery completions.

### Delivery guarantee and trade-off

The database claim prevents two workers from processing the same `SCHEDULED` row concurrently, and BullMQ uses deterministic job IDs. This is **at-least-once**, not strict exactly-once: SMTP and PostgreSQL cannot commit atomically. If SMTP accepts a message but recording `SENT` fails, the worker logs the database error and releases/retries the row where possible; startup stale-row recovery handles a failed recovery update. A retry in this window can duplicate a message. Ethereal does not provide a database-coordinated idempotency key.

## Dashboard and search

- Dashboard tabs show individual scheduled/processing emails and sent/failed emails, with email, subject, time, and status; lists are paginated and refreshed periodically.
- Search uses Elasticsearch across recipient address, subject, body, and campaign name. PostgreSQL remains authoritative; indexed documents are filtered by the authenticated user's ID.
- Bull Board is available at `http://localhost:3001/admin/queues` and requires an authenticated session.
- CSV/TXT uploads are parsed and validated before scheduling; duplicate addresses are removed.

## Backlog demonstration

The optional seed script creates a future-dated campaign and queues at least 1,000 addresses, without sending them during a normal demo:

```sh
npm run seed:backlog --workspace backend
# Optional size (1,000–10,000):
npm run seed:backlog --workspace backend -- 2500
```

It uses the first existing user and existing sender records read-only. The first send is scheduled at least 24 hours in the future. Each execution creates a new demo campaign; it does not delete prior records.

The generated manual lead files are in [`samples/`](./samples): `test.csv`, `mixed.csv`, and `leads-1000.csv`.

## Tests and build checks

```sh
npm test
npm run typecheck
npm run build
```

The backend test suite includes HTTP-level campaign validation, email-list response/pagination, CSV multipart parsing/counts/deduplication, and unauthenticated-access checks. It also tests stale-row reconciliation order, retry-state release, terminal-state idempotency, delayed job movement, queue helper output/recovery, Slack token encryption/disconnected behavior, and real Redis Lua concurrency/check-order/slot-release behavior. The email-list HTTP test injects its read service so it does not write to PostgreSQL. Redis must be running for the backend suite.

Manual end-to-end delivery check (creates a campaign and sends three Ethereal test messages; run only when that database and SMTP test traffic are acceptable):

```sh
npm run e2e:send-check --workspace backend
```

## Demo checklist and assumptions

1. Sign in with Google, upload a CSV, and schedule a future campaign.
2. Show scheduled individual rows, then sent rows and the Ethereal message previews.
3. Restart the backend before a future scheduled send; show startup reconciliation and the later delivery.
4. For a backlog demo, seed 1,000+ future jobs and show the Bull Board delayed queue without sending the addresses to real recipients.
5. If Slack credentials and a public HTTPS callback are available, connect Slack and demonstrate the sender-limit DM.

The project uses Ethereal fake SMTP accounts, fixed one-hour epoch windows (not rolling windows), dual-write indexing with a startup reindex pass, and a five-minute stale-processing recovery threshold. A demo recording and external OAuth setup must be supplied by the operator; they cannot be generated by the source code.
