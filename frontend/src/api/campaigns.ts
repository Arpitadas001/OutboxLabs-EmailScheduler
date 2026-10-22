import api from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CampaignStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  status: CampaignStatus;
  startAt: string;
  totalEmails: number;
  sentCount: number;
  failedCount: number;
  /** Live count of emails in SCHEDULED or PROCESSING state (from DB). */
  queuedCount: number;
  delaySeconds: number;
  hourlyLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignPayload {
  name: string;
  subject: string;
  body: string;
  emails: string[];
  startAt: string;
  delaySeconds: number;
  hourlyLimit: number;
}

export interface EmailRow {
  id: string;
  recipientEmail: string;
  status: 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';
  scheduledAt: string;
  sentAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  attemptCount: number;
  campaign: { subject: string; name: string };
}

export interface EmailsPage {
  emails: EmailRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/** Fetch all campaigns for the current user (includes live queuedCount). */
export async function fetchCampaigns(): Promise<Campaign[]> {
  const res = await api.get<Campaign[]>('/campaigns');
  return res.data;
}

/** Create a new campaign and its scheduled email rows. */
export async function createCampaign(payload: CreateCampaignPayload): Promise<Campaign> {
  const res = await api.post<Campaign>('/campaigns', payload);
  return res.data;
}

/** Cancel a campaign — marks all pending emails CANCELLED and removes BullMQ jobs. */
export async function cancelCampaign(campaignId: string): Promise<{ cancelled: number }> {
  const res = await api.delete<{ cancelled: number }>(`/campaigns/${campaignId}`);
  return res.data;
}

/** Fetch a paginated list of email rows for a campaign. */
export async function fetchCampaignEmails(
  campaignId: string,
  page = 1,
  limit = 50,
): Promise<EmailsPage> {
  const res = await api.get<EmailsPage>(`/campaigns/${campaignId}/emails`, {
    params: { page, limit },
  });
  return res.data;
}

/** Fetch paginated scheduled or sent emails across all campaigns. */
export async function fetchEmails(
  view: 'scheduled' | 'sent',
  page = 1,
  limit = 50,
): Promise<EmailsPage> {
  const res = await api.get<EmailsPage>('/emails', {
    params: { view, page, limit },
  });
  return res.data;
}
