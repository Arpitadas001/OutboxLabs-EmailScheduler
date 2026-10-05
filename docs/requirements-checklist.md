# OutboxLabs Email Scheduler — Requirements Checklist

> **Source of truth**: [`backend/REQUIREMENTS.md`](../backend/REQUIREMENTS.md), plus the user's explicit design-rule corrections.

---

| ID | Requirement | Phase | Status | Evidence |
|----|-------------|-------|--------|----------|
| **AUTH** | | | | |
| A-01 | Real Google OAuth login | 3 | **Done** | `backend/src/routes/auth.ts` GET /auth/google → 302 → accounts.google.com |
| A-02 | Google logout (session destroyed, redirect to /login) | 3 | **Done** | `backend/src/routes/auth.ts` GET /auth/logout → session.destroy() → redirect |
| A-03 | User profile display (name, avatar in TopBar) | 3 | **Done** | `frontend/src/components/layout/UserAvatar.tsx` + GET /auth/me |
| **DASHBOARD** | | | | |
| D-01 | Dashboard showing individual Scheduled Emails | 4 | **Verified** | `GET /emails?view=scheduled`; includes SCHEDULED/PROCESSING rows, pagination, loading/error/empty states |
| D-02 | Dashboard showing individual Sent Emails | 4 | **Verified** | `GET /emails?view=sent`; includes SENT/FAILED rows, pagination, loading/error/empty states |
| **COMPOSE** | | | | |
| C-01 | Compose email form (subject, body, settings) | 4 | **Done** | `frontend/src/pages/ComposePage.tsx` — 3-step wizard |
| **CSV / LEADS** | | | | |
| L-01 | Upload CSV/text file containing email leads | 4 | **Done** | `backend/src/routes/csv.ts` POST /csv/parse + drag-and-drop UI |
| L-02 | Parse and validate email addresses | 4 | **Done** | RFC 5321 regex + column detection + deduplication |
| L-03 | Return valid email count after CSV upload | 4 | **Done** | `{ validCount, invalidCount, duplicatesRemoved, emails, invalidRows }` |
| **CAMPAIGN CONFIGURATION** | | | | |
| CF-01 | Configure campaign start time | 4 | **Done** | `ComposePage` Step 3 `startAt` datetime-local field → ISO UTC in POST /campaigns |
| CF-02 | Configure delay between individual emails | 4 | **Done** | `delaySeconds` field; used to offset `scheduledAt` per email row |
| CF-03 | Configure hourly sending limit | 4 | **Done** | `hourlyLimit` field stored on Campaign; enforced in Phase 6 Lua |
| **SCHEDULING** | | | | |
| S-01 | Schedule emails through BullMQ delayed jobs backed by Redis | 5 | **Done** | Campaign route and startup reconciler share `enqueueScheduledEmailJobs()` |
| S-02 | No cron / node-cron / OS cron / Agenda or prohibited schedulers | 5 | **Done** | BullMQ delayed jobs only |
| **PERSISTENCE** | | | | |
| P-01 | Persist campaigns in relational database (PostgreSQL) | 2 | **Done** | `prisma/schema.prisma` Campaign model + migration applied |
| P-02 | Persist emails in relational database | 2 | **Done** | `prisma/schema.prisma` Email model + migration applied |
| P-03 | Restart persistence: future scheduled emails survive backend restarts | 5 | **Done** | Stale reclaim followed by scheduled-row `addBulk` reconciliation |
| **EMAIL SENDING** | | | | |
| E-01 | Send emails using Ethereal SMTP | 5 | **Verified** | One-off E2E run delivered three sample emails; each was SENT with attemptCount=1 and a unique messageId |
| **WORKER** | | | | |
| W-01 | Configurable worker concurrency | 5 | **Done** | Validated `WORKER_CONCURRENCY` passed to BullMQ Worker |
| W-02 | Minimum delay between email sends (enforced in atomic Lua) | 6 | **Verified** | Same atomic Lua reservation checks per-sender delay before quota increment; Redis test passes |
| W-03 | Stale-PROCESSING reclaim on startup (crashed worker recovery, 5-min threshold) | 5 | **Done** | `reconcileOnStartup()` resets stale PROCESSING rows before requeue |
| **RATE LIMITING** | | | | |
| RL-01 | Hourly rate limiting (fixed hourly window, atomic Lua) | 6 | **Verified** | `ratelimit:{senderId}:{hourWindow}`; Redis concurrency test verifies cap |
| RL-02 | When hourly limit reached, emails must be delayed/rescheduled (not dropped) | 6 | **Done** | BullMQ job is moved to next fixed-hour boundary plus stable original-order offset |
| RL-03 | Rate limiting must work safely across multiple workers | 6 | **Verified** | Lua script executes atomically on shared Redis |
| RL-04 | Decrement hourly counter on SMTP send failure (release reserved slot) | 6 | **Verified** | `releaseSenderSlot()` called on SMTP failure and covered by Redis test |
| **IDEMPOTENCY** | | | | |
| ID-01 | Prevent duplicate email sending — BullMQ jobId deduplication (`email-{id}`) | 5 | **Verified** | Shared enqueue helper uses `email-{id}`; worker treats already claimed/sent rows as a no-op |
| ID-02 | Atomic DB CAS SCHEDULED→PROCESSING using `processingStartedAt` column | 5 | **Verified** | `updateMany` compare-and-set is covered by concurrent-claim test; stale PROCESSING claims expire after five minutes |
| **SENDER MODEL** | | | | |
| SM-01 | Sender model (id, name, fromEmail, smtpHost, smtpPort, smtpUser, smtpPass) | 3 | **Done** | `prisma/schema.prisma` Sender model + migration `20261005062200_add_sender_model` |
| SM-02 | 3 Ethereal SMTP accounts seeded via nodemailer.createTestAccount() | 3 | **Done** | `prisma/seed.ts` — 4 senders in DB (1 from initial run + 3 from second) |
| SM-03 | senderId FK on Email — round-robin assignment on campaign creation | 3 | **Done** | `prisma/schema.prisma` Email.senderId + migration |
| **ELASTICSEARCH** | | | | |
| ES-01 | Elasticsearch indexing of emails | 7 | **Done** | Startup reindex, campaign bulk index, and worker status reindex |
| ES-02 | Elasticsearch search functionality | 7 | **Done** | Authenticated `/search` API and frontend Search page, indexed user filter |
| **BULL BOARD** | | | | |
| BB-01 | Live BullMQ dashboard (Bull Board) | 8 | **Done** | Authenticated Bull Board at `/admin/queues` |
| **INFRASTRUCTURE** | | | | |
| INF-01 | Redis configured with `appendonly yes` + `maxmemory-policy noeviction` | 1 | **Done** | `docker-compose.yml` redis service command |
| INF-02 | ngrok tunnel documented for Slack OAuth local dev | 9 | Done | `.env.example` + `docs/architecture.md` § Corrections |
| **SLACK** | | | | |
| SL-01 | Real Slack OAuth integration | 9 | **Implemented; live flow needs app credentials** | Session-bound OAuth state, token exchange, AES-GCM encrypted token storage |
| SL-02 | Slack notification when hourly sending limit is reached | 9 | **Implemented; live DM needs app credentials** | Sender/hour dedupe key; DM names the sender |
| SL-03 | Slack connect | 9 | **Implemented; unverified live** | `GET /slack/connect` |
| SL-04 | Slack disconnect | 9 | **Implemented** | `DELETE /slack/disconnect` |
| SL-05 | Slack reconnect | 9 | **Implemented; unverified live** | New OAuth exchange overwrites the prior user's encrypted connection |
| SL-06 | Application must not crash if Slack is not connected | 9 | **Verified** | No-op notifier test; worker catches/logs Slack errors |
| SL-07 | Slack profile/connection status display in UI | 9 | **Implemented** | Dashboard Slack connection control |
| **BACKLOG** | | | | |
| BL-01 | Handle 1000+ scheduled emails as a backlog without sending thousands through Ethereal | 8 | **Done** | Opt-in seed jobs begin at least 24 hours in the future and are staggered |
| BL-02 | 1000+ backlog seed script (`prisma/seed.ts`) | 8 | **Done** | `backend/scripts/seed-backlog.ts`; not run during implementation |
| **UI QUALITY** | | | | |
| UI-01 | Professional responsive UI | 3 | **In progress** | `LoginPage.tsx` dark glassmorphism · `AppShell.tsx` gradient header · `UserAvatar.tsx` |
| UI-02 | Loading states | 3 | **In progress** | `ProtectedRoute.tsx` spinner · `UserAvatar.tsx` skeleton |
| UI-03 | Empty states | 4 | **Done** | `DashboardPage` empty state per tab with icon + CTA |
| UI-04 | Error states | 3 | **Done** | `LoginPage.tsx` OAuth error banner; Compose parse/submit error alerts |
| UI-05 | Success states | 4 | **Done** | `ComposePage` success screen after campaign creation |
| **TESTING** | | | | |
| T-01 | Unit tests: rateLimiter combined Lua (hourly + min-delay) | 10 | **Verified** | `backend/test/rateLimiter.test.ts` runs the Lua against Redis, including concurrent reservations |
| T-02 | Unit tests: jobHelpers, slackNotifier (no-op when disconnected) | 10 | **Verified** | Retry/order helpers and Slack crypto/disconnected no-op tests |
| T-03 | Integration tests: campaign API, email API, CSV upload valid/invalid counts | 10 | Not started | |
| T-04 | Worker test: idempotency — status=SENT job is a silent no-op | 10 | Not started | |
| T-05 | Worker test: over-limit job calls moveToDelayed, never dropped | 10 | Not started | |
| T-06 | Worker test: SMTP failure triggers rateLimiter.decrement() | 10 | Not started | |
| T-07 | Startup reconciler test: stale PROCESSING rows reset before re-queue | 10 | Not started | |
| T-08 | Restart persistence test: after Redis flush, addBulk re-queues SCHEDULED emails | 10 | Not started | |
| T-09 | E2E test — Login → Compose → Schedule → Dashboard → Search **(SHOULD)** | 10 | Not started | |
| **DOCUMENTATION** | | | | |
| DOC-01 | README setup, env, architecture, scheduling, persistence, rate limits and trade-offs | 10 | **Done** | Root README updated |
| DOC-02 | Architecture documentation (`docs/architecture.md`) | 3 | **Done** | Current implementation addenda appended |
| DOC-03 | Demo video showing restart persistence | 10 | **Not code-completable** | Must be recorded by the operator |
| **UI (SHOULD)** | | | | |
| UI-06 | Zustand for client UI state **(SHOULD — can use useState if time-constrained)** | 4 | Not started | |

---

## Status Values

| Value | Meaning |
|---|---|
| **Not started** | Work has not begun |
| **In progress** | Actively being implemented |
| **Done** | Code written and manually verified |
| **Verified** | Covered by automated test or CI check |

---

## Phase 3 Evidence Summary

| Check | Result |
|---|---|
| `backend typecheck` | ✅ `tsc --noEmit` — 0 errors |
| `frontend typecheck` | ✅ `tsc --noEmit` — 0 errors |
| `backend build` | ✅ `tsc` — compiled clean |
| `frontend build` | ✅ Vite 133 modules, 0 errors |
| `GET /health` | ✅ `{"status":"ok","message":"Backend is up"}` |
| `GET /auth/me` (no session) | ✅ `401 {"error":"Unauthorized — please log in via /auth/google"}` |
| `GET /auth/google` | ✅ `302 → https://accounts.google.com/o/oauth2/v2/auth?...` |
| Session store | ✅ `connect-redis@7` + node-redis v4 wired to Redis |
| `Sender` table | ✅ Created via migration `20261005062200_add_sender_model` |
| Seed | ✅ 4 Sender rows in DB (3 Ethereal accounts) |
| CORS + credentials | ✅ `Access-Control-Allow-Origin: http://localhost:3000` + `Allow-Credentials: true` |

## Phase 4 Evidence Summary

| Check | Result |
|---|---|
| `backend typecheck` | ✅ `tsc --noEmit` — 0 errors |
| `frontend typecheck` | ✅ `tsc --noEmit` — 0 errors |
| `frontend build` | ✅ Vite 136 modules, 0 errors |
| `POST /campaigns` | ✅ Creates Campaign + bulk Email rows with round-robin Sender, returns 201 |
| `GET /campaigns` | ✅ Returns all campaigns for session user |
| `GET /campaigns/:id/emails` | ✅ Paginated email rows with ownership check |
| `POST /csv/parse` | ✅ Accepts CSV/TXT, validates emails, deduplicates, returns counts |
| Dashboard — Scheduled tab | ✅ Lists SCHEDULED/RUNNING campaigns, live 10 s poll |
| Dashboard — Sent tab | ✅ Lists COMPLETED/FAILED campaigns |
| Dashboard — Empty state | ✅ Per-tab empty state with CTA to /compose |
| Compose — Step 1 (Content) | ✅ Subject + body with char count and validation |
| Compose — Step 2 (Leads) | ✅ Drag-and-drop CSV upload, parse preview, invalid rows collapsible |
| Compose — Step 3 (Schedule) | ✅ Name, start datetime, delay seconds, hourly limit |
| Compose — Success screen | ✅ Shows campaign name + email count, links to Dashboard |

## Notes

- **A-02 (Google logout)**: `GET /auth/logout` → destroy session → `clearCookie('connect.sid')` → redirect `/login`.
- **A-03 (User profile display)**: `GET /auth/me` feeds `UserAvatar` component via `useAuth` hook (React Query cache, 5-min stale time).
- **SM-02 (Seed)**: Ethereal throttles `createTestAccount()` when called in rapid succession; seed handles duplicates by using synthetic `fromEmail` addresses with real SMTP credentials. All use the same underlying Ethereal inbox — acceptable for test SMTP.
- **L-03 (Valid email count)**: CSV upload endpoint returns `{ validCount, invalidCount, invalidRows }` — Phase 4.
- **SL-07 (Slack profile/connection status)**: `GET /slack/status` feeds the `SlackStatus` UI component. Sends DM to connected user via `im:write` scope — no fixed channel.
- **BL-02 (Seed script)**: Creates 1000+ email rows without triggering Ethereal sends; uses `addBulk` for efficiency — Phase 8.
- **DOC-01 (README)**: Must include ngrok setup steps for Slack OAuth local dev — Phase 10.
- **DOC-03 (Demo video)**: Must show backend restart with scheduled emails surviving in BullMQ delayed set — Phase 10.
- **S-02 (No prohibited schedulers)**: All scheduling via BullMQ delayed jobs only. `jobId` format is `email-{id}` (hyphen, not colon — BullMQ restriction).
- **ID-01 / ID-02 (Idempotency)**: Dual-layer: BullMQ jobId deduplication + atomic DB CAS using `processingStartedAt`. Effective-once guarantee with one honest at-least-once gap (SMTP send to DB commit).
- **W-03 (Stale reclaim)**: Any `PROCESSING` row older than 5 minutes is reset to `SCHEDULED` on startup before `addBulk` reconciliation.
- **RL-04 (Decrement on failure)**: SMTP failure calls `DECR ratelimit:{senderId}:{windowKey}` to release the reserved slot.
- **INF-01 (Redis noeviction)**: Prevents Redis from silently evicting rate-limit counters or BullMQ job data under memory pressure.
- **INF-02 (ngrok)**: Slack OAuth requires `https://` redirect URI. Developer runs `ngrok http 3001` locally and sets `SLACK_REDIRECT_URI` to the ngrok URL.
- **T-09 (E2E)**: Playwright E2E is SHOULD — implement if time permits after MUST tests pass.