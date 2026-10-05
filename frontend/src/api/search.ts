import api from './client';

export interface EmailSearchResult {
  id: string;
  campaignId: string;
  campaignName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';
  scheduledAt: string;
  sentAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  score: number | null;
}

export interface EmailSearchPage {
  hits: EmailSearchResult[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function searchEmails(query: string, page = 1): Promise<EmailSearchPage> {
  const response = await api.get<EmailSearchPage>('/search', {
    params: { q: query, page, limit: 20 },
  });
  return response.data;
}
