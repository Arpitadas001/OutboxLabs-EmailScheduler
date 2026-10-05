# OutboxLabs Email Scheduler — Implementation Plan

## Timeline: ~24 hours of focused work

Tricky requirements (scheduling, rate limiting, multi-worker persistence, idempotency) are front-loaded so they are working and testable before UI polish begins.

---

## Phase 0 — Repository & Infrastructure Setup (2h)

**Goal**: Every engineer can run the stack in one command.

### MUST
- [ ] Initialize monorepo structure: `backend/`, `frontend/`, `docs/`, `scripts/`
- [ ] `docker-compose.yml` with Postgres, Redis (AOF), Elasticsearch, backend, worker (×2), frontend
- [ ] `backend/` — `pnpm init`, TypeScript, `tsconfig.json`, `nodemon` + `ts-node` for dev
- [ ] `frontend/` — `pnpm create vite@latest . --template react-ts`, Tailwind CSS setup
- [ ] `.env.example` with all variables documented
- [ ] Prisma init: `schema.prisma` with User, Campaign, Email models + migrations
- [ ] Redis connection module with health-check
- [ ] Elasticsearch client setup + index template creation on startup
- [ ] `Makefile` / `package.json` scripts: `dev`, `build`, `test`, `seed`, `docker:up`

### SHOULD
- [ ] GitHub Actions CI skeleton (lint + test)
- [ ] ESLint + Prettier config for both workspaces

**Deliverable**: `docker compose up` runs all services; Prisma migrations apply; ES index created.

---

## Phase 1 — Google OAuth + Session (2h)

**Goal**: Real login/logout working; protected routes enforced.

### MUST
- [ ] `passport-google-oauth20` strategy in `backend/src/auth/`
- [ ] `express-session` + `connect-redis` (Redis store) configured with `httpOnly` cookie
- [ ] `GET /auth/google` → redirect to Google
- [ ] `GET /auth/google/callback` → upsert User in DB → set session → redirect frontend
- [ ] `GET /auth/logout` → destroy session → redirect `/login`
- [ ] `GET /auth/me` → return `{ id, name, email, picture }` from session
- [ ] `requireAuth` middleware guarding all `/api/*` and `/slack/*` routes
- [ ] Frontend: `LoginPage` with Google Sign-In button
- [ ] Frontend: `useAuth` hook calling `/auth/me`, stores in Zustand
- [ ] Frontend: `UserAvatar` component with name + picture in TopBar
- [ ] Protected route wrapper redirecting unauthenticated users to `/login`

### SHOULD
- [ ] Session expiry (24h) with silent refresh on `/auth/me`

**Deliverable**: Full OAuth round-trip; user can log in, see profile, and log out.

---

## Phase 2 — BullMQ Worker Engine (Core) (4h)

**Goal**: The hardest part — scheduling, rate limiting, persistence, idempotency working correctly.

### MUST

#### 2a. BullMQ Queue + Job Infrastructure
- [ ] `emailQueue.ts` — Queue definition, `addEmailJob(email)` helper with deterministic `jobId: email:${emailId}`
- [ ] `jobHelpers.ts` — `calculateDelay(startAt, index, delaySeconds)` for staggered scheduling
- [ ] Worker entrypoint `worker.ts` (separate from API server, same Docker image)

#### 2b. Atomic Rate Limiter
- [ ] `rateLimiter.ts` implementing the Lua script for hourly window counter
  - Redis key: `ratelimit:hourly:{userId}:{windowKey}`
  - Returns `{ count, overLimit }`
- [ ] Minimum delay check: `GET last_send:{userId}`; if too soon → `moveToDelayed`
- [ ] Over-limit re-delay: `job.moveToDelayed(nextWindowStart + jitter, token)` — **never drop**

#### 2c. Idempotency
- [ ] Atomic DB CAS: `UPDATE Email SET status='PROCESSING' WHERE id=$1 AND status='SCHEDULED'`
- [ ] Worker checks `0 rows returned` → silent return (already processed)
- [ ] Worker checks `status === 'SENT'` → silent return

#### 2d. Email Sending
- [ ] `mailer.ts` — Ethereal SMTP transport via `nodemailer`; `sendMail()` returns `{ messageId }`
- [ ] Worker: after send → immediately `UPDATE Email SET status='SENT', sentAt, messageId`
- [ ] Worker: on failure → `UPDATE Email SET status='FAILED', errorMessage`

#### 2e. Restart Persistence
- [ ] `reconcileOnStartup.ts` — queries all `SCHEDULED`/`PROCESSING` emails → re-adds to queue
- [ ] Called before Express server accepts connections
- [ ] Test: stop backend, restart, verify delayed jobs still fire

#### 2f. Slack Notification (on rate-limit)
- [ ] `slackNotifier.ts` — graceful no-op if `!user.slackToken`; posts to channel when limit hit
- [ ] Dedup: set Redis key `slack_notified:{userId}:{windowKey}` with TTL 3600s to avoid spam

### SHOULD
- [ ] Dead-letter logging for permanently failed jobs
- [ ] `GET /api/queue/stats` — JSON stats (active, delayed, completed, failed counts)

**Deliverable**: Worker sends emails with correct rate limiting; restart persistence verified; idempotency verified.

---

## Phase 3 — Campaign & Email API (3h)

**Goal**: Full CRUD for campaigns; CSV upload; email scheduling.

### MUST
- [ ] `POST /api/campaigns` — create campaign, parse CSV, validate emails, persist Email rows, enqueue jobs
  - Return: `{ campaignId, totalEmails, validCount, invalidCount, invalidRows[] }`
- [ ] `GET /api/campaigns` — paginated list with stats (sentCount, totalEmails, status)
- [ ] `GET /api/campaigns/:id` — detail view + email list (paginated, filterable by status)
- [ ] `DELETE /api/campaigns/:id` — cancel: `job.remove()` for all pending jobs, set status=CANCELLED
- [ ] CSV/text parsing middleware (`multer` + custom parser):
  - Accepts `text/csv`, `text/plain`
  - Validates each row with email regex + `validator.js`
  - Returns valid email list + invalid count
- [ ] Seed script `prisma/seed.ts`:
  - Creates 1 test campaign with 1000+ Email rows
  - Schedules them spread over future hours (respects hourlyLimit)
  - **Does not actually send** — just creates DB rows + enqueues delayed jobs

### SHOULD
- [ ] Campaign pause/resume (move jobs to/from delayed)
- [ ] `GET /api/campaigns/:id/emails` with cursor-based pagination for 1000+ rows

**Deliverable**: Full campaign lifecycle; CSV upload returns valid/invalid counts; 1000+ email backlog demonstrable.

---

## Phase 4 — Elasticsearch & Search (2h)

**Goal**: Emails indexed and full-text searchable.

### MUST
- [ ] `esIndexer.ts` — `index(email)`, `update(id, fields)`, `reindex()` from DB bulk
- [ ] Index created on startup with mapping from architecture doc
- [ ] Dual-write in worker: after DB → SENT, immediately `esIndexer.update()`
- [ ] Dual-write in API: after creating Email rows, `esIndexer.index()` for each
- [ ] `GET /api/search?q=&status=&campaignId=&from=0&size=20` — multi_match query
- [ ] `reindexFromDb()` called on startup if index missing/empty

### SHOULD
- [ ] Search result highlighting (`highlight` in ES query)
- [ ] Aggregations: status counts per search result

**Deliverable**: Search page returns relevant emails; new sends appear in search within seconds.

---

## Phase 5 — Slack OAuth (1.5h)

**Goal**: Connect/disconnect Slack; receive rate-limit notifications.

### MUST
- [ ] `GET /slack/connect` — redirect to Slack OAuth with `chat:write users:read` scopes
- [ ] `GET /slack/callback` — exchange code → `oauth.v2.access` → encrypt + save token to User
- [ ] `DELETE /slack/disconnect` — clear `slackToken`, `slackUserId`, `slackTeamId`
- [ ] `GET /slack/status` — returns `{ connected: bool, teamName?, slackUserName? }`
- [ ] `slackNotifier.ts` integrated in worker rate-limit path
- [ ] Frontend: `SlackStatus` component in Dashboard — shows connected/disconnected + profile
- [ ] Frontend: Connect/Disconnect buttons calling respective API endpoints
- [ ] App never crashes if Slack is not connected (verified in tests)

### SHOULD
- [ ] Show Slack workspace name and user name when connected

**Deliverable**: Full Slack OAuth round-trip; notifications sent; graceful no-op when disconnected.

---

## Phase 6 — Frontend UI (4h)

**Goal**: Professional, responsive UI with all required states.

### MUST

#### Dashboard
- [ ] Campaign list with status badges, sent/total progress bar, timestamps
- [ ] Stats bar: total campaigns, total sent, total scheduled, total failed
- [ ] Scheduled Emails and Sent Emails tabs / sections
- [ ] `SlackStatus` widget in sidebar or header

#### Compose / Create Campaign
- [ ] Form: name, subject, body (rich text or textarea), start time, delay, hourly limit
- [ ] CSV uploader: drag-and-drop + file picker; shows valid/invalid counts after upload
- [ ] Recipient chips preview (first 10 valid emails)
- [ ] Submit → creates campaign → redirects to Campaign Detail

#### Campaign Detail
- [ ] Email table: recipient, status badge, scheduledAt, sentAt (paginated, virtual scroll for 1000+)
- [ ] Campaign stats card
- [ ] Cancel button

#### Search
- [ ] Search bar with debounce (300ms)
- [ ] Results list with highlighted matches
- [ ] Status filter dropdown

#### All views
- [ ] Loading skeleton (no blank screens)
- [ ] Empty state with CTA
- [ ] Error boundary with retry
- [ ] Success toasts

### SHOULD
- [ ] Dark mode toggle
- [ ] Responsive mobile layout
- [ ] Bull Board iframe embed at `/admin/queues`

**Deliverable**: All pages functional, polished, responsive.

---

## Phase 7 — Bull Board + Queue Dashboard (0.5h)

### MUST
- [ ] `@bull-board/express` mounted at `/admin/queues`
- [ ] Protected by `requireAuth` middleware
- [ ] Shows active, delayed, completed, failed jobs with retry/remove actions

---

## Phase 8 — Tests (2h)

### MUST
- [ ] Unit: `rateLimiter.ts` — concurrent calls stay within limit
- [ ] Unit: `jobHelpers.ts` — deterministic jobId, delay calculation
- [ ] Unit: `slackNotifier.ts` — no-op when token absent
- [ ] Integration: `POST /api/campaigns` — creates campaign, returns valid/invalid counts
- [ ] Worker: `status=SENT` job → silent no-op (no duplicate send)
- [ ] Worker: over-limit job → `moveToDelayed` called, not dropped
- [ ] Worker: startup reconciler → Redis flush → emails re-queued
- [ ] E2E (Playwright): Login → Create campaign → Upload CSV → Verify dashboard → Search

### SHOULD
- [ ] Coverage threshold: 70% line coverage on `src/services/` and `src/workers/`

---

## Phase 9 — Documentation & README (1h)

### MUST
- [ ] `README.md`:
  - Project overview
  - Architecture diagram (ASCII)
  - Prerequisites (Node 20, Docker, Google Cloud project, Slack app)
  - Setup steps (clone → `.env` → `docker compose up` → seed)
  - Running tests
  - How to demo restart persistence
  - Environment variables reference
- [ ] `docs/architecture.md` (this document)
- [ ] `docs/implementation-plan.md` (this document)
- [ ] `docs/requirements-checklist.md` (separate checklist)

### SHOULD
- [ ] Demo video (Loom/OBS): shows login → campaign → scheduling → rate-limit notification → backend restart → jobs survive

---

## Summary: MUST vs SHOULD

| Category | MUST items | SHOULD items |
|---|---|---|
| Infrastructure | Docker, Prisma, Redis AOF | CI/CD, linting |
| Auth | Google OAuth, sessions, logout, profile | Silent session refresh |
| Worker | Rate limit (Lua), idempotency, re-delay, restart persistence | Dead-letter logging |
| Campaigns | Create, list, detail, CSV upload, seed 1000+ | Pause/resume |
| Slack | OAuth, connect/disconnect, notifications, graceful no-op | Workspace profile display |
| Search | ES dual-write, multi_match search API, UI | Highlighting, aggregations |
| Frontend | All pages, all states (loading/empty/error/success) | Dark mode, mobile |
| Tests | Unit + integration + 1 E2E | Coverage thresholds |
| Docs | README, architecture, plan, checklist | Demo video |

---

## Phase Order Rationale

The order above is intentional:

1. **Infrastructure first** (Phase 0) — no development without a working stack.
2. **Auth second** (Phase 1) — every API endpoint needs it; unblocks all other work.
3. **Worker engine third** (Phase 2) — the hardest, riskiest part; catches design flaws early.
4. **API fourth** (Phase 3) — builds on worker; no UI needed to test with curl/Postman.
5. **ES + Slack** (Phases 4–5) — isolated features, can run in parallel after Phase 3.
6. **Frontend last** (Phase 6) — backend API is stable, UI connects to real endpoints.
7. **Tests + docs** (Phases 8–9) — written alongside code but finalized at end.
