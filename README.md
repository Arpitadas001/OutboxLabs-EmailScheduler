# OutboxLabs Email Scheduler

A production-grade full-stack email scheduling system. Schedules bulk email campaigns via a clean dashboard, processes jobs through BullMQ + Redis, sends through Ethereal SMTP, indexes records in Elasticsearch, and integrates Google OAuth and Slack OAuth.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Setup Instructions](#3-setup-instructions)
4. [Rate Limiting and Concurrency](#4-rate-limiting-and-concurrency)
5. [Persistence and Idempotency](#5-persistence-and-idempotency)
6. [Features Implemented](#6-features-implemented)
7. [Assumptions and Trade-offs](#7-assumptions-and-trade-offs)

---

## 1. Project Overview

**What it does:** Upload a CSV of recipients, write one email subject and body, and schedule the campaign to send starting at a chosen time. The backend stores all records in PostgreSQL, queues delayed jobs in BullMQ (backed by Redis), and sends through Ethereal SMTP test accounts. Rate limits and minimum delays are enforced atomically via Redis Lua scripts.

**Main features:**
- Google OAuth 2.0 login (real, not mocked)
- CSV/TXT upload with client- and server-side validation and deduplication
- 3-step campaign compose wizard (content → leads → schedule)
- BullMQ delayed jobs with per-sender round-robin assignment
- Configurable worker concurrency, minimum send delay, and hourly rate limit
- Slack OAuth with real DM notification when a sender hits its hourly limit
- Elasticsearch indexing on write + full-text search across recipient, subject, body, campaign
- Bull Board live queue dashboard (`/admin/queues`)
- Dashboard with paginated scheduled and sent email tables, auto-refreshed every 5 s
- System health page with live checks for PostgreSQL, Redis, and Elasticsearch

**Tech stack:**

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Tailwind CSS, Vite, Axios, React Query |
| Backend | Node.js 20, Express, TypeScript, Prisma ORM |
| Queue | BullMQ 5, ioredis |
| Database | PostgreSQL 16 (via Docker) |
| Session store | Redis 7 (node-redis v4 + connect-redis) |
| Email | Ethereal SMTP (nodemailer) |
| Search | Elasticsearch 8.13 |
| Auth | Google OAuth 2.0 (google-auth-library), Slack OAuth v2 |
| Queue UI | @bull-board/express |
| Infra | Docker Compose |

---

## 2. Architecture

```
Browser (React + Vite :3000)
        |
        | HTTP  /api/*  (proxied in dev)
        v
Express API (:3001)
  |-- /auth/*        -- Google OAuth, session management
  |-- /campaigns/*   -- create/list campaigns + email rows
  |-- /emails/*      -- list scheduled / sent emails (paginated)
  |-- /csv/*         -- multipart CSV parsing endpoint
  |-- /search/*      -- Elasticsearch full-text search
  |-- /slack/*       -- Slack OAuth connect/disconnect/callback
  `-- /admin/queues  -- Bull Board (BullMQ monitoring UI)
        |
        | (same process, separate event loop callbacks)
        v
BullMQ Worker (concurrency: WORKER_CONCURRENCY)
  1. Load email row from PostgreSQL
  2. Atomic CAS: SCHEDULED -> PROCESSING (idempotency gate)
  3. Lua script: check min-delay slot + hourly counter in Redis
     |-- ALLOWED: SMTP send via Ethereal -> mark SENT in PG -> index in ES
     `-- RATE LIMITED: release PROCESSING -> moveToDelayed (next window) -> DelayedError
        |
        |-- PostgreSQL 16  (campaigns, emails, senders, users)
        |-- Redis 7        (BullMQ jobs, rate-limit counters, session store)
        `-- Elasticsearch  (email search index)
```

**How the frontend communicates with Express:** Axios with `withCredentials: true` sends session cookies. In development, Vite proxies `/api`, `/auth`, `/slack`, `/admin` to `localhost:3001`.

**How emails are saved:** `POST /campaigns` runs a Prisma transaction that creates the Campaign and all Email rows atomically. After the transaction, `emailQueue.addBulk()` enqueues BullMQ delayed jobs (one per recipient).

**How BullMQ and Redis schedule jobs:** Each job has ID `email-{emailId}` (BullMQ deduplication key) and a `delay` equal to `max(0, scheduledAt - now)`. Redis stores job state durably (AOF persistence + `noeviction` policy).

**How workers send emails:** Workers pick up eligible jobs, perform the CAS check, run the Lua rate-limiter, call nodemailer's SMTP transport against Ethereal, and update the DB. On success the email is indexed in Elasticsearch.

**How Elasticsearch search works:** On campaign creation, `indexCampaignEmails()` bulk-indexes all emails. After each SENT/FAILED update, `indexEmail(emailId)` re-indexes the single document. On startup, `reindexAllEmails()` re-syncs the entire index. The search endpoint queries across `recipientEmail^3`, `subject^2`, `body`, `campaignName` and filters by `userId`.

**How Slack notifications work:** When a sender hits its hourly limit, `notifySenderRateLimit()` looks up the user's encrypted Slack token, opens a DM via `conversations.open`, and posts the alert with `chat.postMessage`. A Redis key prevents duplicate notifications for the same sender+window.

---

## 3. Setup Instructions

### Prerequisites

- Node.js 20+
- Docker Desktop / Docker Compose
- Google Cloud project with OAuth 2.0 credentials
- (Optional) Slack app with `chat:write`, `im:write`, `users:read` scopes and HTTPS callback

### Step 1 - Clone and install

```sh
git clone <repo-url>
cd OutboxLabs-EmailScheduler
npm install
```

### Step 2 - Configure environment

```sh
cp .env.example .env
# Edit .env with your real values
```

Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | `postgresql://user:password@localhost:5432/outboxlabs` |
| `REDIS_URL` | `redis://localhost:6379` |
| `ELASTICSEARCH_URL` | `http://localhost:9200` |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_CALLBACK_URL` | `http://localhost:3001/auth/google/callback` |
| `SESSION_SECRET` | Random string, min 32 chars |
| `ENCRYPTION_KEY` | Random string, min 32 chars (encrypts Slack tokens at rest) |
| `SLACK_CLIENT_ID` | Slack app client ID (optional) |
| `SLACK_CLIENT_SECRET` | Slack app client secret (optional) |
| `SLACK_REDIRECT_URI` | `https://<ngrok-url>/slack/callback` (Slack requires HTTPS) |
| `WORKER_CONCURRENCY` | Number of jobs processed concurrently (default: `5`) |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | Minimum ms between sends per sender (default: `1000`) |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Per-sender hourly cap (default: `100`) |

### Step 3 - Start Docker services

```sh
docker compose up -d
```

This starts PostgreSQL 16, Redis 7 (AOF enabled), and Elasticsearch 8.13.

### Step 4 - Run database migrations

```sh
cd backend
npx dotenv -e ../.env -- npx prisma migrate deploy
```

### Step 5 - Seed Ethereal SMTP senders

```sh
cd backend
npx dotenv -e ../.env -- ts-node --transpile-only prisma/seed.ts
```

Creates 3 Ethereal test accounts in the Sender table.

### Step 6 - Configure Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/):
1. Create an OAuth 2.0 Client ID (Web application)
2. Add `http://localhost:3001/auth/google/callback` as an authorised redirect URI
3. Copy Client ID and Client Secret into `.env`

### Step 7 - Configure Slack OAuth (optional)

1. Create a Slack app at https://api.slack.com/apps
2. Add Bot Token Scopes: `chat:write`, `im:write`, `users:read`
3. Expose your backend with ngrok: `ngrok http 3001`
4. Add `https://<ngrok-subdomain>.ngrok.io/slack/callback` as OAuth Redirect URL
5. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI` in `.env`

### Step 8 - Start the application

```sh
# Terminal 1 - backend + BullMQ worker
cd backend
npx dotenv -e ../.env -- ts-node src/index.ts

# Terminal 2 - Vite frontend
cd frontend
npm run dev
```

### Step 9 - Verify

| URL | What you should see |
|---|---|
| http://localhost:3000 | Login page |
| http://localhost:3001/api/health | `{ status: "ok" }` |
| http://localhost:3001/api/health/dependencies | PostgreSQL/Redis/ES status |
| http://localhost:3001/admin/queues | Bull Board (requires login) |

---

## 4. Rate Limiting and Concurrency

### Worker Concurrency

Configured via `WORKER_CONCURRENCY` environment variable (default: `5`). The BullMQ worker is created with `{ concurrency: env.WORKER_CONCURRENCY }`.

### Minimum Delay Between Emails

Configured via `MIN_DELAY_BETWEEN_EMAILS_MS` (default: `1000` ms). The campaign form also has a `delaySeconds` field; the effective minimum is `max(env.MIN_DELAY_BETWEEN_EMAILS_MS, campaign.delaySeconds * 1000)`.

Enforced via a Redis key `ratelimit:slot:{senderId}` that records the timestamp of the last reservation. The Lua script checks this **before** consuming an hourly slot, so rejected delay checks do not waste quota.

### Hourly Rate Limiting

Configured via `MAX_EMAILS_PER_HOUR_PER_SENDER` (default: `100`). Each campaign's compose form sets an `hourlyLimit` that overrides the default.

**How Redis coordinates it (atomic Lua script):**

```
KEYS[1] = ratelimit:{senderId}:{hourWindow}   (counter)
KEYS[2] = ratelimit:slot:{senderId}           (last-send timestamp)
```

The script atomically:
1. Checks if `now - lastSend < minDelayMs` -> reject with `MIN_DELAY`
2. Reads the counter; if `counter >= hourlyLimit` -> reject with `HOURLY_LIMIT`
3. Otherwise increments the counter (with TTL 3700 s) and records the timestamp

Because this is a single Lua script, it executes atomically in Redis - safe across multiple workers and application instances.

**What happens when the limit is reached:**
1. The job detects `HOURLY_LIMIT` rejection
2. `notifySenderRateLimit()` fires a Slack DM (deduplicated per window per sender)
3. The email status is reset from `PROCESSING` -> `SCHEDULED`
4. `job.moveToDelayed(nextWindowStart + deterministicOffset)` reschedules the job
5. `throw new DelayedError()` tells BullMQ the job is deferred, not failed
6. The deterministic offset (`emailOrderIndex * minDelayMs`) preserves send order within the next window

**Multiple senders:** Senders are assigned round-robin at campaign creation (`senderIndex = emailIndex % senderCount`). Each sender has its own Redis counter key, so Sender B's limit is completely independent of Sender A's.

---

## 5. Persistence and Idempotency

### How scheduled jobs survive restarts

Two layers of persistence:

1. **Redis with AOF** - BullMQ stores delayed jobs durably. When Redis restarts with AOF, jobs are restored automatically.

2. **Startup reconciler** - Every time the backend starts, `reconcileOnStartup()`:
   - Reclaims stale `PROCESSING` emails (older than 5 minutes) -> resets to `SCHEDULED`
   - Finds all `SCHEDULED` emails in PostgreSQL -> calls `emailQueue.addBulk()`
   - BullMQ silently ignores jobs whose ID already exists (deduplication via jobId)

Even if Redis is completely wiped, restarting the backend re-queues all pending emails from PostgreSQL. **Jobs survive server restarts unconditionally.**

### How database records and queue state are managed

- Campaign and Email rows are created in a single Prisma transaction
- Emails begin with `status = 'SCHEDULED'`
- The worker atomically transitions: `SCHEDULED -> PROCESSING -> SENT/FAILED`
- BullMQ job state and DB status are kept consistent via the CAS guard

### How duplicate jobs are prevented

**Layer 1 - BullMQ jobId:** Every job is created with `jobId = "email-{emailId}"`. BullMQ refuses to enqueue a job whose ID already exists. Duplicate calls to `addBulk()` during reconciliation are silently ignored.

**Layer 2 - DB CAS:** Inside the worker:
```sql
UPDATE email SET status='PROCESSING', processingStartedAt=NOW()
WHERE id=? AND status='SCHEDULED'
```
If `count === 0`, another worker already claimed it - skip. Prevents double-processing under concurrent workers.

### What happens when SMTP succeeds but the worker crashes before recording SENT

This is the classic at-least-once vs exactly-once trade-off:

1. SMTP sends the message (Ethereal accepts it)
2. Worker crashes before `UPDATE email SET status='SENT'`
3. On restart, the startup reconciler finds the email still `PROCESSING`
4. The worker attempts the email again -> Ethereal accepts the message a second time

**Trade-off:** The system is **at-least-once**, not strictly exactly-once. SMTP and PostgreSQL cannot commit atomically. In a production system, use SMTP idempotency keys or a two-phase commit pattern. The 5-minute stale-PROCESSING threshold limits the retry window.

---

## 6. Features Implemented

| Feature | Status | Notes |
|---|---|---|
| TypeScript + Express backend | Yes | Full strict TypeScript |
| BullMQ + Redis | Yes | Delayed jobs, deduplication via jobId |
| PostgreSQL + Prisma ORM | Yes | 4 migrations, full schema |
| Ethereal SMTP integration | Yes | 3 seeded sender accounts, round-robin |
| Persistent delayed jobs | Yes | Redis AOF + startup reconciler |
| Duplicate scheduling prevention | Yes | BullMQ jobId + DB CAS |
| Configurable worker concurrency | Yes | `WORKER_CONCURRENCY` env var |
| Minimum delay between sends | Yes | Redis Lua `ratelimit:slot:*` key |
| Configurable hourly rate limit | Yes | `MAX_EMAILS_PER_HOUR_PER_SENDER` + per-campaign override |
| Redis-coordinated rate limiting | Yes | Single atomic Lua script |
| Rescheduling on rate limit | Yes | `moveToDelayed` + `DelayedError` |
| Real Slack OAuth + DM notification | Yes | AES-256-GCM encrypted token storage |
| Elasticsearch indexing + search | Yes | Dual-write on create/update + startup reindex |
| Live BullMQ dashboard (Bull Board) | Yes | `/admin/queues` (session-protected) |
| React + TypeScript frontend | Yes | Vite, React Query, Tailwind CSS |
| Google OAuth login | Yes | Real OAuth 2.0, no mocked auth |
| User name / email / avatar / logout | Yes | Shown in top navigation bar |
| Compose email form | Yes | 3-step wizard: content -> leads -> schedule |
| CSV/TXT upload + recipient counting | Yes | Client + server validation, dedup |
| Scheduled Emails table | Yes | Paginated, auto-refreshes every 5 s |
| Sent Emails table | Yes | With sentAt, failedAt, errorMessage |
| Loading / empty / error states | Yes | All three for every table and form |
| Search page (Elasticsearch) | Yes | Multi-field search with pagination |
| System Health page | Yes | Live checks for PG, Redis, ES |
| Docker Compose | Yes | PostgreSQL, Redis, Elasticsearch |
| Multiple senders | Yes | Round-robin across seeded Ethereal accounts |

### Known limitations

- **Exactly-once SMTP delivery:** The system is at-least-once (documented above).
- **Rolling-window rate limits:** The hourly counter uses fixed clock-aligned 1-hour epochs, not a sliding window. A burst at 10:58 and another at 11:02 count against different windows.
- **Slack requires HTTPS callback:** For local testing, ngrok is needed. The app gracefully degrades if Slack credentials are absent.
- **Worker co-location:** The BullMQ worker runs in the same process as the HTTP server (acceptable for an assignment; production would split them).

---

## 7. Assumptions and Trade-offs

| Decision | Rationale |
|---|---|
| BullMQ jobId = `"email-{emailId}"` | Deterministic deduplication without a separate idempotency-key column |
| Fixed 1-hour epoch windows | Simpler implementation; rolling windows would require a Redis sorted set |
| Worker in same process as API | Reduces operational complexity for a demo |
| Prisma `createMany` then `findMany` for campaign emails | Prisma does not return IDs from `createMany` in PostgreSQL |
| Startup reindex of Elasticsearch | Tolerates ES downtime during operation; re-syncs on next restart |
| 5-minute stale-PROCESSING threshold | Balances crash recovery speed vs. false-positive duplicate risk |
| Slack token AES-256-GCM encrypted at rest | Tokens contain user write access; encrypting protects against direct DB read |
| `express-session` + Redis store | Simple to reason about, survives Redis restarts (AOF) |

---

## Additional Scripts

```sh
# Generate 1,000+ demo email jobs (future-dated, no real sending)
cd backend
npx dotenv -e ../.env -- ts-node --transpile-only scripts/seed-backlog.ts

# Manual E2E send check (creates a 3-email campaign and sends via Ethereal)
cd backend
npx dotenv -e ../.env -- ts-node --transpile-only scripts/e2e-send-check.ts
```

## Sample files

The `samples/` directory contains:
- `test.csv` - 3 addresses for quick testing
- `mixed.csv` - mix of valid and invalid addresses
- `leads-1000.csv` - 1,000 addresses for load demo

## Ethereal Preview

After emails are sent, the preview URL is logged in the backend console:

```
[Worker] Sent email cm... -> alice@example.com
         Preview: https://ethereal.email/message/...
```
