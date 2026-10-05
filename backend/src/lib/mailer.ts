import nodemailer, { Transporter, SentMessageInfo } from 'nodemailer';

/**
 * Creates a nodemailer SMTP transport for a given Sender row.
 *
 * Why a factory?
 *   - Each Sender has independent credentials (different Ethereal accounts).
 *   - Creating a new transport per send is cheap — nodemailer is stateless
 *     between sends (it opens a connection, sends, closes).
 *   - Avoids sharing a single transport across concurrent sends, which could
 *     cause connection-pool contention with Ethereal's free tier.
 */
export function createSmtpTransport(
  smtpHost: string,
  smtpPort: number,
  smtpUser: string,
  smtpPass: string,
): Transporter<SentMessageInfo> {
  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false, // Ethereal uses STARTTLS on port 587
    auth: { user: smtpUser, pass: smtpPass },
    // Increase timeouts slightly for Ethereal's shared SMTP server
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

/**
 * Returns the Ethereal web-preview URL for a sent message, or null if unavailable.
 * Only works for messages sent through smtp.ethereal.email — not real SMTP.
 */
export function getEtherealPreviewUrl(info: SentMessageInfo): string | false {
  return nodemailer.getTestMessageUrl(info);
}
