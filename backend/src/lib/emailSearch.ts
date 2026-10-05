import { env } from '../config/env';
import { prisma } from './prisma';

const INDEX_NAME = 'emails';
const BULK_BATCH_SIZE = 500;

interface IndexedEmail {
  id: string;
  campaignId: string;
  campaignName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  userId: string;
  updatedAt: string;
}

export interface EmailSearchHit extends IndexedEmail {
  id: string;
  score: number | null;
}

function endpoint(path: string): string {
  return `${env.ELASTICSEARCH_URL.replace(/\/$/, '')}/${path}`;
}

async function checkResponse(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  const detail = await response.text();
  throw new Error(`Elasticsearch ${operation} failed (${response.status}): ${detail}`);
}

export async function ensureEmailIndex(): Promise<void> {
  const head = await fetch(endpoint(INDEX_NAME), { method: 'HEAD' });
  if (head.ok) return;
  if (head.status !== 404) {
    await checkResponse(head, 'index check');
  }

  const response = await fetch(endpoint(INDEX_NAME), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mappings: {
        properties: {
          id: { type: 'keyword' },
          campaignId: { type: 'keyword' },
          campaignName: { type: 'text' },
          recipientEmail: { type: 'text', fields: { exact: { type: 'keyword' } } },
          subject: { type: 'text' },
          body: { type: 'text' },
          status: { type: 'keyword' },
          scheduledAt: { type: 'date' },
          sentAt: { type: 'date' },
          failedAt: { type: 'date' },
          errorMessage: { type: 'text' },
          userId: { type: 'keyword' },
          updatedAt: { type: 'date' },
        },
      },
    }),
  });
  await checkResponse(response, 'index creation');
}

async function indexedEmail(emailId: string): Promise<IndexedEmail | null> {
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { campaign: true },
  });
  if (!email) return null;

  return {
    id: email.id,
    campaignId: email.campaignId,
    campaignName: email.campaign.name,
    recipientEmail: email.recipientEmail,
    subject: email.campaign.subject,
    body: email.campaign.body,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    failedAt: email.failedAt?.toISOString() ?? null,
    errorMessage: email.errorMessage,
    userId: email.campaign.userId,
    updatedAt: email.updatedAt.toISOString(),
  };
}

export async function indexEmail(emailId: string): Promise<void> {
  const document = await indexedEmail(emailId);
  if (!document) return;
  const response = await fetch(endpoint(`${INDEX_NAME}/_doc/${encodeURIComponent(emailId)}`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(document),
  });
  await checkResponse(response, `document indexing for ${emailId}`);
}

export async function indexCampaignEmails(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, userId: true, name: true, subject: true, body: true },
  });
  if (!campaign) return;

  const total = await prisma.email.count({ where: { campaignId } });
  for (let skip = 0; skip < total; skip += BULK_BATCH_SIZE) {
    const emails = await prisma.email.findMany({
      where: { campaignId },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      skip,
      take: BULK_BATCH_SIZE,
    });
    if (emails.length === 0) continue;

    const lines = emails.flatMap((email) => [
      JSON.stringify({ index: { _index: INDEX_NAME, _id: email.id } }),
      JSON.stringify({
        id: email.id,
        campaignId: campaign.id,
        campaignName: campaign.name,
        recipientEmail: email.recipientEmail,
        subject: campaign.subject,
        body: campaign.body,
        status: email.status,
        scheduledAt: email.scheduledAt.toISOString(),
        sentAt: email.sentAt?.toISOString() ?? null,
        failedAt: email.failedAt?.toISOString() ?? null,
        errorMessage: email.errorMessage,
        userId: campaign.userId,
        updatedAt: email.updatedAt.toISOString(),
      }),
    ]);
    const response = await fetch(endpoint('_bulk'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson' },
      body: `${lines.join('\n')}\n`,
    });
    await checkResponse(response, `bulk indexing for campaign ${campaignId}`);
    const result = await response.json() as { errors?: boolean; items?: Array<Record<string, { status?: number; error?: unknown }>> };
    if (result.errors) {
      const failed = result.items?.filter((item) =>
        Object.values(item).some((entry) => (entry.status ?? 200) >= 300),
      ).length ?? 0;
      throw new Error(`Elasticsearch bulk indexing reported ${failed} failed email documents for campaign ${campaignId}.`);
    }
  }
}

export async function reindexAllEmails(): Promise<void> {
  const campaigns = await prisma.campaign.findMany({ select: { id: true } });
  for (const campaign of campaigns) {
    await indexCampaignEmails(campaign.id);
  }
}

export async function searchEmails(
  userId: string,
  query: string,
  page: number,
  limit: number,
): Promise<{ hits: EmailSearchHit[]; total: number }> {
  const response = await fetch(endpoint(`${INDEX_NAME}/_search`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: (page - 1) * limit,
      size: limit,
      track_total_hits: true,
      query: {
        bool: {
          must: [{
            multi_match: {
              query,
              fields: ['recipientEmail^3', 'subject^2', 'body', 'campaignName'],
              type: 'best_fields',
              operator: 'and',
            },
          }],
          filter: [{ term: { userId } }],
        },
      },
      sort: [{ _score: 'desc' }, { scheduledAt: 'desc' }],
    }),
  });
  await checkResponse(response, 'search');

  const result = await response.json() as {
    hits: {
      total: number | { value: number };
      hits: Array<{ _id: string; _score: number | null; _source: Omit<IndexedEmail, 'id'> }>;
    };
  };
  return {
    total: typeof result.hits.total === 'number' ? result.hits.total : result.hits.total.value,
    hits: result.hits.hits.map((hit) => ({
      ...hit._source,
      id: hit._id,
      score: hit._score,
    })),
  };
}
