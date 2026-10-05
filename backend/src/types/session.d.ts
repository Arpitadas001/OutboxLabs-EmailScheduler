// Augment express-session to add our custom fields.
// This file is picked up automatically by TypeScript because it is in src/.
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** The authenticated User's DB primary key (cuid). */
    userId: string;
    slackOAuthState?: string;
  }
}
