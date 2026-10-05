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
  startAt: string; // ISO datetime
  totalEmails: number;
  sentCount: number;
  failedCount: number;
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
  startAt: string; // ISO datetime
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

/** Fetch all campaigns for the current user. */
export async function fetchCampaigns(): Promise<Campaign[]> {
  const res = await api.get<Campaign[]>('/campaigns');
  return res.data;
}

/** Create a new campaign and its scheduled email rows. */
export async function createCampaign(payload: CreateCampaignPayload): Promise<Campaign> {
  const res = await api.post<Campaign>('/campaigns', payload);
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
