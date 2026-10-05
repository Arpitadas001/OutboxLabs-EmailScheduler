# OutboxLabs Email Scheduler — Architecture

> **Source of truth**: The assignment is in `backend/REQUIREMENTS.md`. This document's original planning sections are superseded where they conflict with the current implementation addenda at the end.

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
│   React (Vite) + TypeScript + Tailwind CSS                          │
│   Pages: Login · Dashboard · Compose · Campaign · Search            │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS / REST + SSE
┌──────────────────────────▼──────────────────────────────────────────┐
│                        API LAYER                                    │
│   Express.js (Node.js + TypeScript)                                 │
│   Auth middleware (Google OAuth 2.0 session)                        │
│   Routes: /auth · /campaigns · /emails · /search · /slack · /queue │
└──────┬────────────┬─────────────┬──────────────┬────────────────────┘
       │            │             │              │
       ▼            ▼             ▼              ▼
  PostgreSQL     Redis          BullMQ        Elasticsearch
  (Prisma ORM)  (Rate-limit   (Job Queue)    (Email index)
                 + session)
                           │
                           ▼
                    ┌──────────────┐
                    │  BullMQ      │
                    │  Workers     │
                    │  (N replicas)│
                    └──────┬───────┘
                           │ sends via
                           ▼
                    Ethereal SMTP
                    (nodemailer)

              Slack API  ◄── Worker (rate-limit alert)
              Bull Board ◄── /admin/queues (Bull Board UI)
```

### Key Design Decisions & Trade-offs

| Decision | Choice | Rationale |
|---|---|---|
| **Frontend framework** | **React + Vite** (not Next.js) | SSR is not needed; the app is authenticated and data-heavy. Vite gives faster DX with zero config. Next.js would add complexity (App Router, RSC, edge runtime) for no benefit here. |
| **ORM** | **Prisma** | Type-safe schema, auto-migrations, excellent PostgreSQL support, built-in seeding. Alternatives (Drizzle, TypeORM, Knex) offer less safety or more boilerplate. |
| **Auth state** | **Server-side sessions** (express-session + Redis store) | Simpler to invalidate immediately on logout/disconnect. JWT would require a blacklist to support Google logout, negating the statelessness advantage. Tokens stored in httpOnly cookies resist XSS. |
| **Elasticsearch sync** | **Post-write dual-write from the API/worker layer** | After every DB write that changes email status, the API/worker also calls `es.index()`. No CDC pipeline needed at this scale. Acceptable because writes are low-frequency (bounded by hourly rate). |

---

## 2. Component Architecture

```
backend/
├── src/
│   ├── config/          # env validation (zod), db, redis, es clients
│   ├── auth/            # Google OAuth passport strategy, session setup
│   ├── slack/           # Slack OAuth, webhook, connection state
│   ├── routes/
│   │   ├── auth.ts      # GET /auth/google, /auth/google/callback, /auth/logout
│   │   ├── campaigns.ts # CRUD campaigns, CSV upload, schedule
│   │   ├── emails.ts    # list, detail, resend
│   │   ├── search.ts    # ES full-text search
│   │   ├── slack.ts     # connect/disconnect/status
│   │   └── queue.ts     # queue stats (delegated to Bull Board)
│   ├── workers/
│   │   ├── emailWorker.ts   # processes email jobs
│   │   └── workerConfig.ts  # concurrency, limiter settings
│   ├── jobs/
│   │   ├── emailQueue.ts    # BullMQ Queue definition + job adder
│   │   └── jobHelpers.ts    # deterministic jobId, delay calculator
│   ├── services/
│   │   ├── mailer.ts        # Ethereal SMTP (nodemailer transport)
│   │   ├── rateLimiter.ts   # Lua-script-based Redis rate limiter
│   │   ├── esIndexer.ts     # Elasticsearch indexing/search
│   │   └── slackNotifier.ts # Slack API calls (graceful-no-op if disconnected)
│   ├── middleware/
│   │   ├── requireAuth.ts
│   │   └── errorHandler.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.ts          # 1000+ email backlog seed script
│   └── index.ts             # Express app bootstrap

frontend/
├── src/
│   ├── api/             # axios instance + typed hooks (React Query)
│   ├── components/
│   │   ├── ui/          # Button, Input, Badge, Spinner, EmptyState, ErrorBoundary
│   │   ├── layout/      # AppShell, Sidebar, TopBar, UserAvatar
│   │   ├── campaign/    # CampaignCard, CampaignForm, CSVUploader, EmailList
│   │   ├── compose/     # ComposeForm, RecipientChips
│   │   └── slack/       # SlackConnect, SlackStatus
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── ComposePage.tsx
│   │   ├── CampaignDetailPage.tsx
│   │   └── SearchPage.tsx
│   ├── store/           # Zustand slices: auth, campaigns, ui
│   ├── hooks/           # useAuth, useCampaigns, useSearch, useSlack
│   └── App.tsx          # Router (React Router v6), protected routes
```

---

## 3. Database Design (PostgreSQL via Prisma)

```prisma
model User {
  id           String     @id @default(cuid())
  googleId     String     @unique
  email        String     @unique
  name         String
  picture      String?
  slackUserId  String?
  slackToken   String?    // AES-256 encrypted at rest
  slackTeamId  String?
  createdAt    DateTime   @default(now())
  campaigns    Campaign[]
}

model Campaign {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  name            String
  subject         String
  body            String    @db.Text
  status          CampaignStatus @default(DRAFT)
  startAt         DateTime
  delaySeconds    Int       // delay between individual sends (min 0)
  hourlyLimit     Int       // max emails per rolling hour
  totalEmails     Int       @default(0)
  sentCount       Int       @default(0)
  failedCount     Int       @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  emails          Email[]
}

enum CampaignStatus {
  DRAFT
  SCHEDULED
  RUNNING
  PAUSED
  COMPLETED
  FAILED
}

model Email {
  id                   String      @id @default(cuid())
  campaignId           String
  campaign             Campaign    @relation(fields: [campaignId], references: [id])
  recipientEmail       String
  status               EmailStatus @default(SCHEDULED)
  scheduledAt          DateTime
  processingStartedAt  DateTime?   // set when status → PROCESSING; used for stale-job reclaim
  sentAt               DateTime?
  failedAt             DateTime?
  errorMessage         String?
  messageId            String?     // Ethereal message ID
  jobId                String      @unique  // BullMQ job ID (idempotency key)
  attemptCount         Int         @default(0)
  createdAt            DateTime    @default(now())
  updatedAt            DateTime    @updatedAt

  @@index([campaignId, status])
  @@index([scheduledAt])
  @@index([jobId])
  @@index([status, processingStartedAt])  // stale-PROCESSING query
}

enum EmailStatus {
  SCHEDULED
  PROCESSING
  SENT
  FAILED
  CANCELLED
}
```

**Notes:**
- `jobId` is stored on the `Email` row and must be unique — used as BullMQ job ID for deduplication.
- `processingStartedAt` enables stale-PROCESSING reclaim: on startup, any row with `status = PROCESSING` and `processingStartedAt < NOW() - 5min` is reset to `SCHEDULED` before reconciliation runs. This prevents a crashed-worker row from being permanently stuck.
- `slackToken` is stored AES-256 encrypted (key from `ENCRYPTION_KEY` env var).
- All timestamps are UTC.

---

## 4. Redis / BullMQ Design

### Queues

| Queue name | Purpose |
|---|---|
| `email-send` | One delayed job per Email row. Job fires at `scheduledAt`. |

### Job Payload

```typescript
interface EmailJobPayload {
  emailId: string;   // DB primary key — worker loads all other fields from DB
}
```

The payload is intentionally minimal. The worker fetches the full `Email` (+ `Campaign` + `User`) from PostgreSQL on pickup. This keeps the Redis payload tiny and avoids stale-data bugs if campaign details change after scheduling.

### Deterministic Job ID

```
jobId = `email-${emailId}`
```

> **Important**: BullMQ forbids the `:` character in custom job IDs. Use `-` as the separator. Adding the same `jobId` twice is a no-op if the job still exists — this is the primary deduplication mechanism.

### BullMQ Queue Options

```typescript
const emailQueue = new Queue('email-send', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});
```

### BullMQ Worker Options

```typescript
const worker = new Worker('email-send', processor, {
  connection: redisConnection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '5'),
  limiter: {
    max: parseInt(process.env.WORKER_RATE_MAX ?? '10'),
    duration: 1000, // BullMQ built-in jobs/second safety valve
  },
});
```

---

## 5. Worker Architecture

```
emailWorker.ts  (runs as separate Docker service, same image as backend)

processor(job) {
  1. Load Email + Campaign + User from DB (payload is emailId only)
  2. Atomic DB status check: SCHEDULED → PROCESSING (set processingStartedAt = NOW())
     - If already PROCESSING/SENT/FAILED → skip (crash-recovery idempotency)
  3. Call rateLimiter.checkAndReserve(userId, hourlyLimit, minDelayMs)
     ← Single atomic Lua script covering BOTH hourly limit AND min-delay slot
     - If OVER_HOURLY_LIMIT:
         a. Decrement hourly counter (reservation rolled back inside Lua)
         b. job.moveToDelayed(nextWindowStart + jitter)  ← re-delay, NOT drop
         c. Notify Slack via DM (if connected) — once per window per user
         d. Reset DB status: PROCESSING → SCHEDULED
         e. Return
     - If MIN_DELAY_NOT_MET:
         a. job.moveToDelayed(lastSendAt + minDelayMs)
         b. Reset DB status: PROCESSING → SCHEDULED
         c. Return
  4. Send email via Ethereal SMTP (nodemailer)
  5. On SUCCESS:
     a. Atomic DB update: PROCESSING → SENT (set sentAt, messageId)
     b. Index email in Elasticsearch
     c. Increment campaign.sentCount
  6. On FAILURE:
     a. rateLimiter.decrement(userId)  ← undo the hourly slot reservation
     b. Atomic DB update: PROCESSING → FAILED (set errorMessage)
     c. Increment campaign.failedCount
}
```

### Stale-PROCESSING Reclaim (on startup)

Before reconciliation runs, reset any rows stuck in `PROCESSING` due to a worker crash:

```typescript
await prisma.email.updateMany({
  where: {
    status: 'PROCESSING',
    processingStartedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) }, // > 5 min ago
  },
  data: { status: 'SCHEDULED', processingStartedAt: null },
});
```

This runs **before** `reconcileScheduledEmails()` so reclaimed rows are picked up in the same startup pass.

### Worker Scaling

- Multiple worker replicas can run safely because:
  - Rate limiting uses a single atomic Lua script in Redis (no race between workers)
  - Job deduplication uses BullMQ's built-in job ID uniqueness
  - DB transition is atomic (`UPDATE ... WHERE status = 'SCHEDULED'`)

---

## 6. Rate-Limiting Strategy (Concrete)

### Redis Keys

```
ratelimit:hourly:{userId}:{windowKey}   → integer count   (TTL: 3700s)
last_send:{userId}                      → Unix ms timestamp of last successful send (TTL: 7200s)
```

- `windowKey = Math.floor(Date.now() / 3_600_000)` — fixed one-hour epoch integer.
- TTL 3700s (> 3600s) ensures the key outlives the window even under clock skew.
- `maxmemory-policy noeviction` on Redis guarantees these keys are never silently evicted.

### Single Atomic Lua Script (hourly limit + minimum delay)

Both checks happen in **one script**, executed atomically. The min-delay check runs first so that if the slot is not yet free we never consume an hourly slot.

```lua
-- KEYS[1] = ratelimit:hourly:{userId}:{windowKey}
-- KEYS[2] = last_send:{userId}
-- ARGV[1] = hourlyLimit        (integer)
-- ARGV[2] = windowTTL          (integer, seconds, e.g. 3700)
-- ARGV[3] = minDelayMs         (integer, e.g. 1000)
-- ARGV[4] = nowMs              (integer, current Unix ms from caller)
--
-- Returns: {resultCode, value}
--   {0, newCount}    → OK, slot reserved; newCount = updated hourly count
--   {1, nextSendMs}  → MIN_DELAY_NOT_MET; nextSendMs = when min delay expires
--   {2, count}       → OVER_HOURLY_LIMIT; count = current count (unchanged)

local nowMs       = tonumber(ARGV[4])
local minDelayMs  = tonumber(ARGV[3])
local hourlyLimit = tonumber(ARGV[1])
local windowTTL   = tonumber(ARGV[2])

-- 1. Check minimum delay BEFORE touching the hourly counter
local lastSend = redis.call('GET', KEYS[2])
if lastSend ~= false then
  local gap = nowMs - tonumber(lastSend)
  if gap < minDelayMs then
    return {1, tonumber(lastSend) + minDelayMs}  -- too soon
  end
end

-- 2. Check and increment hourly counter
local current = redis.call('GET', KEYS[1])
if current == false then
  redis.call('SET', KEYS[1], 1, 'EX', windowTTL)
  redis.call('SET', KEYS[2], nowMs, 'EX', windowTTL * 2)
  return {0, 1}
end
local count = tonumber(current)
if count >= hourlyLimit then
  return {2, count}  -- over limit — do NOT increment
end
redis.call('INCR', KEYS[1])
redis.call('SET', KEYS[2], nowMs, 'EX', windowTTL * 2)
return {0, count + 1}
```

### Decrement on Send Failure

If SMTP send fails after the slot was reserved, the worker calls:

```typescript
await rateLimiter.decrement(userId, windowKey);
// DECR ratelimit:hourly:{userId}:{windowKey}  (floor at 0)
```

This releases the slot so the next retry attempt gets a fair chance within the same window.

### Over-Limit Re-delay

```typescript
const windowKey = Math.floor(Date.now() / 3_600_000);
const nextWindowStart = (windowKey + 1) * 3_600_000;
const jitter = Math.floor(Math.random() * 5_000); // 0–5 s, spreads thundering herd
await job.moveToDelayed(nextWindowStart + jitter, token);  // never dropped
```

### Multi-Worker Correctness

Redis executes Lua scripts atomically — no two workers can interleave inside the script. With `noeviction` policy and AOF persistence, counters survive Redis restarts and are never silently lost.

---

## 7. Idempotency Strategy

### Guarantee: **At-Least-Once** (a duplicate is possible in the SMTP-to-database gap)

BullMQ provides at-least-once delivery. Layered checks prevent duplicate processing in ordinary retries and concurrent claims, but they cannot close the SMTP-to-database crash window described below.

### Layer 1 — BullMQ Job ID deduplication

```typescript
await emailQueue.add('send', { emailId }, {
  jobId: `email-${emailId}`,   // '-' separator — BullMQ forbids ':' in custom IDs
  delay: delayMs,
});
```

### Layer 2 — Atomic DB status transition (Compare-and-Swap)

```sql
UPDATE "Email"
SET status = 'PROCESSING', "updatedAt" = NOW()
WHERE id = $1 AND status = 'SCHEDULED'
RETURNING *;
```

- Returns `0 rows` → another worker already claimed it → abort silently.
- Prevents double-send even if two workers race on the same job.

### Layer 3 — Crash Recovery Analysis

| Crash point | Result | Safe? |
|---|---|---|
| Before DB update (status still SCHEDULED) | BullMQ retries → Layer 2 CAS succeeds → sends once | ✅ |
| After SMTP send, before DB → SENT | BullMQ retries → SMTP sends again | ⚠️ at-least-once gap |
| After DB → SENT | BullMQ retry → Layer 2 CAS finds SENT → silent abort | ✅ |

**Honest assessment**: SMTP and PostgreSQL cannot participate in one atomic transaction. If SMTP accepts a message and the following database transaction fails, delivery may already have happened while the database still says `PROCESSING`. The worker logs the persistence error and attempts to release the row back to `SCHEDULED`, allowing BullMQ's retry to claim it; if PostgreSQL is unavailable for that recovery update too, startup stale-`PROCESSING` reconciliation can reclaim it after five minutes. Either recovery may send the message again because Ethereal SMTP does not provide an idempotency key coordinated with the database. The honest guarantee is **at-least-once delivery with a possible duplicate in the SMTP-to-database crash window**, not exactly-once delivery.

SMTP failures are handled separately from post-send database failures. While BullMQ retries remain, the worker resets `PROCESSING` to `SCHEDULED` before rethrowing so the next attempt can win the atomic claim. It records `FAILED` and increments the campaign failure count only on the final configured attempt.

---

## 8. Restart-Persistence Strategy

BullMQ delayed jobs live in Redis sorted sets (`bull:email-send:delayed`). Redis runs with AOF persistence (`appendonly yes`), so jobs survive restarts.

**Startup sequence:**

```typescript
// src/jobs/reconcileOnStartup.ts
export async function reconcileOnStartup() {
  // Step 1: Reclaim stale PROCESSING rows (worker crashed mid-flight)
  await prisma.email.updateMany({
    where: {
      status: 'PROCESSING',
      processingStartedAt: { lt: new Date(Date.now() - 5 * 60_000) },
    },
    data: { status: 'SCHEDULED', processingStartedAt: null },
  });

  // Step 2: Re-queue all SCHEDULED rows using addBulk for efficiency
  const emails = await prisma.email.findMany({
    where: { status: 'SCHEDULED' },
    select: { id: true, scheduledAt: true },
  });

  const jobs = emails.map((email) => ({
    name: 'send',
    data: { emailId: email.id },                     // slim payload — worker loads rest from DB
    opts: {
      jobId: `email-${email.id}`,                    // '-' not ':' — BullMQ requirement
      delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
    },
  }));

  await emailQueue.addBulk(jobs);                    // single Redis round-trip for all jobs
  console.log(`Reconciled ${emails.length} emails on startup`);
}
```

- `addBulk` sends all job additions in a single pipelined Redis command — efficient for 1000+ rows.
- BullMQ silently ignores any job whose `jobId` already exists in Redis — no duplicates.
- Step 1 (stale reclaim) runs before Step 2 so reclaimed rows are included in the bulk re-queue.

---

## 9. Elasticsearch Strategy

### Index: `emails`

```json
{
  "mappings": {
    "properties": {
      "id":              { "type": "keyword" },
      "campaignId":      { "type": "keyword" },
      "campaignName":    { "type": "text" },
      "recipientEmail":  { "type": "keyword" },
      "subject":         { "type": "text" },
      "body":            { "type": "text" },
      "status":          { "type": "keyword" },
      "scheduledAt":     { "type": "date" },
      "sentAt":          { "type": "date" },
      "userId":          { "type": "keyword" }
    }
  }
}
```

### Sync Approach: Post-write Dual-Write

1. API creates Email row in PostgreSQL → immediately calls `esIndexer.index(email)`.
2. Worker updates `status → SENT` in PostgreSQL → calls `esIndexer.update(id, { status, sentAt })`.
3. No CDC pipeline required at this scale.
4. Elasticsearch is **search-only** — PostgreSQL remains authoritative.
5. On startup, `esIndexer.reindex()` bulk-re-indexes from PostgreSQL if ES index is stale/missing.

### Search API

```
GET /api/search?q=<query>&status=<status>&campaignId=<id>&from=0&size=20
```

Uses `multi_match` across `subject`, `body`, `recipientEmail`, `campaignName`.

---

## 10. Google OAuth Flow

```
Browser                  Backend                  Google
  │                         │                        │
  │── GET /auth/google ─────►│                        │
  │                         │── redirect ────────────►│
  │                         │                        │ (user consents)
  │◄────────────────────────│◄── code ───────────────│
  │                         │                        │
  │                         │── exchange code ───────►│
  │                         │◄── access_token ────────│
  │                         │                        │
  │                         │  upsert User in DB      │
  │                         │  set req.session.userId │
  │◄── redirect /dashboard ─│                        │
```

- **Strategy**: `passport-google-oauth20`
- **Session**: `express-session` + `connect-redis` (Redis store)
- **Scopes**: `profile email`
- **Logout**: `GET /auth/logout` → destroys session, redirects to `/login`
- **Profile display**: `GET /auth/me` returns `{ id, name, email, picture }` from session

---

## 11. Slack OAuth Flow

```
Browser                  Backend                  Slack
  │                         │                        │
  │── GET /slack/connect ───►│                        │
  │                         │── redirect ────────────►│
  │                         │                        │ (user installs app)
  │◄────────────────────────│◄── code ───────────────│
  │                         │                        │
  │                         │── oauth.v2.access ─────►│
  │                         │◄── bot_token ───────────│
  │                         │                        │
  │                         │  encrypt & save token   │
  │                         │  to User.slackToken     │
  │◄── redirect /dashboard ─│                        │
```

- **Scopes**: `chat:write`, `im:write`, `users:read`
- **Notification target**: Worker sends a **direct message to the connected user** (via `conversations.open` + `chat.postMessage`), not a fixed channel. `SLACK_CHANNEL_ID` env var is removed.
- **Token storage**: AES-256 encrypted in `User.slackToken`
- **Disconnect**: `DELETE /slack/disconnect` → clears token; user can reconnect anytime
- **Graceful degradation**: `slackNotifier.ts` begins with `if (!user.slackToken) return;` — app **never throws** if Slack is absent
- **Local dev requirement**: Slack OAuth requires an `https://` redirect URI. Use **ngrok** (or similar tunnel) locally: `ngrok http 3001` → set `SLACK_REDIRECT_URI=https://<ngrok-subdomain>.ngrok.io/slack/callback` in `.env`. Document this in the README.

---

## 12. Frontend Page / Component Structure

| Page | Route | Key Components |
|---|---|---|
| Login | `/login` | `GoogleSignInButton`, `AppLogo` |
| Dashboard | `/` | `CampaignList`, `StatsBar`, `SlackStatus`, `UserAvatar` |
| Compose | `/compose` | `ComposeForm`, `CSVUploader`, `RecipientChips`, `CampaignScheduler` |
| Campaign Detail | `/campaigns/:id` | `EmailTable` (paginated), `CampaignStats`, `StatusBadge` |
| Search | `/search` | `SearchBar`, `SearchResults`, `EmailDetailModal` |

### State Management

- **React Query** (TanStack Query v5): server state, caching, background refetch — **MUST**
- **React Hook Form + Zod**: form validation — **MUST**
- **Zustand**: client-only UI state (sidebar open, modal visibility) — **SHOULD** (can use `useState` if time-constrained)

### Required UI States (every data view)

- ⏳ Loading skeleton
- 📭 Empty state with CTA
- ❌ Error state with retry button
- ✅ Success toast (`react-hot-toast`)

---

## 13. Backend API Structure

```
GET    /auth/google                   → initiate OAuth (browser redirect)
GET    /auth/google/callback           → OAuth callback
GET    /auth/logout                    → destroy session, redirect /login
GET    /auth/me                        → current user profile

POST   /api/campaigns                  → create campaign + schedule emails
GET    /api/campaigns                  → list campaigns (paginated)
GET    /api/campaigns/:id              → campaign detail + stats
DELETE /api/campaigns/:id              → cancel pending jobs

POST   /api/campaigns/:id/emails       → bulk upload CSV (multipart)
GET    /api/campaigns/:id/emails       → list emails (paginated + filter)

GET    /api/search                     → Elasticsearch full-text search

GET    /slack/connect                  → initiate Slack OAuth
GET    /slack/callback                 → Slack OAuth callback
DELETE /slack/disconnect               → remove Slack token
GET    /slack/status                   → connection status + profile

GET    /admin/queues                   → Bull Board UI
GET    /api/queue/stats                → JSON queue stats (active/delayed/failed)
```

---

## 14. Docker Infrastructure Plan

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment: POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
    volumes: [postgres-data:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    command: >-
      redis-server
      --appendonly yes
      --maxmemory-policy noeviction
    # appendonly yes  → AOF persistence; jobs survive Redis restarts
    # noeviction      → Redis never silently evicts rate-limit counters or job data
    volumes: [redis-data:/data]

  elasticsearch:
    image: elasticsearch:8.13.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    volumes: [es-data:/usr/share/elasticsearch/data]

  backend:
    build: ./backend
    depends_on: [postgres, redis, elasticsearch]
    ports: [3001:3001]

  worker:
    build: ./backend
    command: node dist/worker.js     # separate entrypoint, same image
    depends_on: [postgres, redis, elasticsearch]
    deploy:
      replicas: 2                    # demonstrates multi-worker safety

  frontend:
    build: ./frontend
    ports: [3000:3000]

volumes:
  postgres-data:
  redis-data:
  es-data:
```

---

## 15. Environment Variables

```bash
# App
NODE_ENV=development
PORT=3001
SESSION_SECRET=<random-32-bytes>
ENCRYPTION_KEY=<random-32-bytes>
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:pass@postgres:5432/outboxlabs

# Redis
REDIS_URL=redis://redis:6379

# Elasticsearch
ELASTICSEARCH_URL=http://elasticsearch:9200

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback

# Slack OAuth
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
# Must be an https:// URL — use ngrok for local dev (see README)
SLACK_REDIRECT_URI=https://<ngrok-subdomain>.ngrok.io/slack/callback
# SLACK_CHANNEL_ID removed — worker DMs the connected user directly

# Worker
WORKER_CONCURRENCY=5
WORKER_RATE_MAX=10
MIN_SEND_DELAY_MS=1000

# Ethereal SMTP
ETHEREAL_HOST=smtp.ethereal.email
ETHEREAL_PORT=587
ETHEREAL_USER=
ETHEREAL_PASS=
```

---

## 16. Testing Strategy

| Layer | Tool | Scope | Priority |
|---|---|---|---|
| Unit | **Vitest** | `rateLimiter.ts`, `jobHelpers.ts`, `mailer.ts`, `esIndexer.ts` | **MUST** |
| Integration | **Vitest + supertest** | API routes with real DB (test DB) + Redis | **MUST** |
| Worker | **Vitest + BullMQ test harness** | Idempotency, crash scenarios, re-delay on over-limit | **MUST** |
| E2E | **Playwright** | Login → Compose → Schedule → Dashboard → Search | **SHOULD** |

### Critical Test Cases (MUST)

1. Lua rate limiter: 5 concurrent workers must not exceed `hourlyLimit`
2. Lua rate limiter: min-delay check fires before hourly counter is incremented
3. Worker: job with status already `SENT` must be a silent no-op
4. Worker: over-limit job must re-delay (moveToDelayed), never drop; hourly counter unchanged
5. Worker: SMTP failure triggers `rateLimiter.decrement()` to release the slot
6. Startup reconciler: stale PROCESSING rows (> 5 min) reset to SCHEDULED before re-queue
7. Startup reconciler: after Redis flush, `SCHEDULED` emails are re-queued via addBulk
8. CSV upload: invalid rows rejected, valid count returned in response

---

## 17. Open Questions / Assumptions

1. **REQUIREMENTS.md missing** — treating prompt requirements as source of truth; please add file and flag any conflicts.
2. **Slack notification target** — DM to the connected user (resolved: `im:write` scope + `conversations.open`). No fixed channel.
3. **Multi-user rate limits** — each user has independent Redis keys; no per-campaign limiting in v1.
4. **CSV format** — one email per line, or CSV with `email` header column; no merge-tags in v1.
5. **Email body** — plain text + HTML multipart in v1.
6. **Demo video** — recorded manually by developer; shows backend restart with jobs surviving in BullMQ delayed set.
7. **Backlog seed** — 1000+ emails scheduled over future hours; `delaySeconds` stagger prevents all 1000 firing at once.
8. **ngrok requirement** — Slack OAuth needs an `https://` redirect URI. Developer must run `ngrok http 3001` during Slack integration setup.

---

## Corrections

> These override the original architecture where they conflict.
> Appended after Phase 3.

| # | Topic | Correction |
|---|---|---|
| 1 | **BullMQ jobId format** | `email-{emailId}` — hyphen separator only. BullMQ forbids `:` in custom job IDs. |
| 2 | **Job payload** | Contains only `emailId`. Worker loads `Email + Campaign + User` from DB on pickup. Keeps Redis payload tiny; avoids stale-data bugs. |
| 3 | **Sender model** | New `Sender` model (id, name, fromEmail, smtpHost, smtpPort, smtpUser, smtpPass, createdAt). `Email` gains `senderId` FK. Three Ethereal accounts seeded via `nodemailer.createTestAccount()` in `prisma/seed.ts`. Campaigns assign senders round-robin. |
| 4 | **Rate-limit keys & Lua** | Keys use `senderId` not `userId`: `ratelimit:{senderId}:{hourWindow}`. Hourly check **and** min-delay slot reservation happen in **one atomic Lua script**. Min-delay check runs first so over-limit never consumes a delay slot. |
| 5 | **Over-limit re-delay** | `nextWindowStart + (emailOrderIndex * minDelayMs)` — deterministic offset based on original email order, not random jitter, so order is preserved. |
| 6 | **Stale PROCESSING reclaim** | Any `PROCESSING` row with `processingStartedAt < NOW() - 5min` is atomically reset to `SCHEDULED` via `UPDATE ... WHERE status = 'PROCESSING'`. Runs before `reconcileOnStartup()`. |
| 7 | **Configurable env vars** | All tuning knobs in env with no hardcoded fallbacks: `WORKER_CONCURRENCY`, `MIN_DELAY_BETWEEN_EMAILS_MS`, `MAX_EMAILS_PER_HOUR_PER_SENDER`. Campaign's `hourlyLimit` field overrides the env default per-campaign. Added to `.env.example` and `env.ts` schema. |
| 8 | **Slack** | DM the connected user via `im:write` + `conversations.open`. `slackNotifier.ts` starts with `if (!user.slackToken) return;` — app never crashes without Slack. OAuth redirect requires an `https://` tunnel (ngrok). `SLACK_CHANNEL_ID` env var removed. |
| 9 | **Startup reconciliation** | Uses `addBulk` (single Redis round-trip) to re-queue all `SCHEDULED` emails. Silently skips jobs whose `jobId` already exists in Redis. Redis configured with `appendonly yes` + `maxmemory-policy noeviction`. |
| 10 | **Auth implementation** | Uses `google-auth-library` OAuth2Client directly (no Passport). Session stores only `userId` in Redis via `connect-redis@7` + node-redis v4. |
| 11 | **Worker rate reservation** | `rateLimiter.ts` uses one Redis Lua execution to check `ratelimit:{senderId}:{hourWindow}` and `ratelimit:slot:{senderId}`. The campaign hourly limit overrides the validated environment default. SMTP failure releases its reserved hourly count. |
| 12 | **SMTP retry state** | SMTP failure returns an email to `SCHEDULED` while BullMQ attempts remain, and marks it `FAILED` only on the final attempt. A post-SMTP database error is logged and does not mark the email failed. |
| 13 | **Actual service guarantee** | At-least-once delivery. There is a possible duplicate if SMTP accepts a message but the subsequent database `SENT` transaction fails and retry/recovery sends it again. |
| 14 | **Email dashboard** | `GET /emails?view=scheduled|sent&page=N&limit=N` returns user-owned individual email rows. Scheduled includes SCHEDULED/PROCESSING; Sent includes SENT/FAILED. |
| 15 | **Search indexing** | Elasticsearch stores scheduled and terminal email documents; campaign creation bulk indexes rows, worker state changes reindex individual rows, startup ensures the index and reindexes existing campaigns. PostgreSQL ownership remains the source of truth for dashboard APIs; search filters indexed user IDs. |
| 16 | **Slack implementation** | `/slack/connect`, `/slack/callback`, `/slack/status`, and `DELETE /slack/disconnect` provide OAuth lifecycle. OAuth state is session-bound; tokens are AES-256-GCM encrypted. Notifications DM the connected user once per sender/hour window. Missing Slack configuration/connection is non-fatal. |
| 17 | **Bull Board and backlog seed** | Authenticated Bull Board is mounted at `/admin/queues`. `npm run seed:backlog --workspace backend` creates 1,000+ future-dated jobs and does not send them during the demo. The seed command is opt-in and was not run as part of implementation. |
| 18 | **Limits and trade-offs** | The delay is enforced between sender reservation/send starts, not SMTP completion times. Zero-delay campaign order uses a stable schedule-time/ID tie-break because the unchanged schema has no original-order column. |
