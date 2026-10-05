# Outbox Labs (ReachInbox) - Full-stack Email Job Scheduler Assignment

Build a production-grade email scheduler service + dashboard that accepts email send requests, schedules them for a specific time, uses BullMQ + Redis as a persistent job scheduler (NO cron jobs), sends via Ethereal Email (fake SMTP), survives server restarts without losing or restarting jobs, and exposes a frontend dashboard.

## Tech requirements
Backend: TypeScript, Express.js, BullMQ (Redis), MySQL or PostgreSQL, Ethereal Email SMTP.
Frontend: React.js or Next.js, Tailwind CSS (or another modern CSS library), TypeScript strongly preferred.
Infra: Redis and DB via Docker (recommended).
Also required: Elasticsearch (index sent/scheduled emails and make them searchable).

## Backend requirements
### 1. Core scheduler
- Accept email scheduling requests via API; store them in the relational DB.
- Schedule with BullMQ delayed jobs (or a custom Redis/DB scheduler). NO cron.
- Send emails from MULTIPLE senders via Ethereal SMTP.
- Sent/scheduled emails must be searchable via Elasticsearch.
- Expose a live BullMQ dashboard for real-time queue visibility.
- Persistence: after a server restart, future emails must still send at the correct time; emails must not be duplicated or restarted from scratch.

### 2. Throughput, rate limiting, concurrency (required)
- Worker concurrency: configurable BullMQ worker concurrency; safe with parallel jobs.
- Delay between emails: a minimum delay between individual sends (BullMQ limiter or custom logic). Document the chosen delay in the README.
- Emails per hour: a rate limit, either global (MAX_EMAILS_PER_HOUR) or per sender/tenant (MAX_EMAILS_PER_HOUR_PER_SENDER; multiple senders must be supported).
  - Limits are configurable via env/config, nothing hardcoded.
  - Must be safe across multiple workers/instances: use Redis- or DB-backed counters (for example keyed by hour_window + sender), not only in-memory counts.
  - When the hourly limit is reached, do NOT drop or permanently fail jobs: delay/reschedule them into the next available hour window, preserving order as much as possible.
  - Explain in the README how it is enforced and the trade-offs.
- Slack notification on rate-limit hit (required):
  - The user clicks "Connect Slack" in the dashboard, goes through a real OAuth authorize flow, and the backend stores the token/webhook per user/tenant.
  - A real Slack message must be sent when a sender's hourly limit is reached. It must be a live, verifiable call in the demo, not a log line.
  - Handle disconnect/reconnect: if Slack is not connected, rate-limit hits must not notify and must not crash. If the user connects later, notifications start working without a redeploy.
- Behaviour under load: define behaviour when 1000+ emails are scheduled for roughly the same time and when the rate limit would be exceeded. Thousands do not need to actually be sent via Ethereal, but the logic must handle it.

### 3. Hard constraints
- NO cron jobs: no OS cron, no node-cron, no agenda, etc.
- Scheduling must use BullMQ delayed jobs or a custom Redis/DB scheduler that is not cron.
- Persistent: after a restart, future emails still send at the right time and are not re-sent or restarted.
- The same queued email must never be sent more than once (idempotency).

## Frontend requirements
Match the provided Figma as closely as possible (Figma link was in the original assignment email).
1. Google login: real Google OAuth (no mock); redirect to the dashboard after login. Header shows the user's name, email and avatar. Provide Logout.
2. Main dashboard: top header (user info + logout), tabs Scheduled Emails and Sent Emails, and a primary "Compose New Email" button.
3. Compose New Email (modal or page): subject, body; upload a CSV/text file of email leads and show the number of addresses detected; start time, delay between emails, hourly limit; a Schedule button that calls the backend schedule API.
4. Scheduled Emails table/list: Email, Subject, Scheduled time, Status; loading state and empty state.
5. Sent Emails table/list: Email, Subject, Sent time, Status (sent / failed); loading state and empty state.
6. Code quality: clean folder structure, reusable UI components, DRY, proper TypeScript types for API responses and props, good UX (loading indicators, empty states, error handling with messages/toasts).

## Submission
1. Private GitHub repo (monorepo or separate folders); grant access to the two reviewers named in the assignment.
2. README covering: how to run backend (Express, Redis, DB, BullMQ worker) and frontend; Ethereal setup and env variables; architecture overview (how scheduling works, how restart persistence works, how rate limiting and concurrency work); the list of implemented features mapped to backend (scheduler, persistence, rate limiting, concurrency) and frontend (login, dashboard, compose, tables).
3. Demo video (max 5 minutes): creating scheduled emails, the dashboard showing Scheduled and Sent, a restart scenario (stop server, start again, future emails still send), and (bonus) rate limiting/delay under load.
4. Note assumptions, shortcuts and trade-offs.
5. Complete the assignment submission form.

Deadline: 2026-10-06, 4:00 PM. Plagiarism results in rejection.