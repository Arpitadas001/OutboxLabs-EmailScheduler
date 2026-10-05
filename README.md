# OutboxLabs Email Scheduler

## Setup Instructions

1. **Prerequisites**: Node 20+, Docker Desktop.
2. **Environment Variables**: Copy `.env.example` to `.env` and fill in the required values.
   ```sh
   cp .env.example .env
   ```
   *Note for Slack OAuth local dev: You need an ngrok tunnel to expose port 3001 as https. Set `SLACK_REDIRECT_URI` to `https://<ngrok-subdomain>.ngrok.io/slack/callback`.*
3. **Install Dependencies**:
   ```sh
   npm install
   ```
4. **Start Infrastructure**:
   ```sh
   npm run docker:up
   ```
5. **Database Setup**:
   ```sh
   npm run prisma:generate --workspace backend
   npm run prisma:migrate --workspace backend
   ```
6. **Start Application**:
   ```sh
   npm run dev
   ```

## Development

- Frontend running on `http://localhost:3000`
- Backend API running on `http://localhost:3001`
