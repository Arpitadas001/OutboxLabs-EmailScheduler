import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import {
  fetchCampaigns,
  fetchEmails,
  type Campaign,
  type EmailRow,
} from '../api/campaigns';
import SlackConnection from '../components/slack/SlackConnection';

type TabId = 'scheduled' | 'sent';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: EmailRow['status'] }) {
  const presentation: Record<EmailRow['status'], { label: string; className: string }> = {
    SCHEDULED: { label: 'Scheduled', className: 'badge-scheduled' },
    PROCESSING: { label: 'Sending', className: 'badge-running' },
    SENT: { label: 'Sent', className: 'badge-completed' },
    FAILED: { label: 'Failed', className: 'badge-failed' },
    CANCELLED: { label: 'Cancelled', className: 'badge-draft' },
  };
  const { label, className } = presentation[status];
  return <span className={`badge ${className}`}>{label}</span>;
}

function EmptyState({ tab }: { tab: TabId }) {
  return (
    <div className="dash-empty">
      <div className="dash-empty-icon" aria-hidden="true">✉</div>
      <p className="dash-empty-title">
        {tab === 'scheduled' ? 'No scheduled emails yet' : 'No sent emails yet'}
      </p>
      <p className="dash-empty-sub">
        {tab === 'scheduled'
          ? 'Create a campaign to see its scheduled emails here.'
          : 'Sent and failed emails will appear here.'}
      </p>
      {tab === 'scheduled' && (
        <Link to="/compose" className="dash-empty-cta">Compose an email</Link>
      )}
    </div>
  );
}

function EmailTable({ emails, tab }: { emails: EmailRow[]; tab: TabId }) {
  if (emails.length === 0) return <EmptyState tab={tab} />;

  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Subject</th>
            <th>{tab === 'scheduled' ? 'Scheduled time' : 'Sent time'}</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {emails.map((email) => (
            <tr key={email.id}>
              <td className="font-medium text-gray-100">{email.recipientEmail}</td>
              <td className="text-gray-400">
                <span title={email.campaign.subject}>{email.campaign.subject}</span>
                {email.status === 'FAILED' && email.errorMessage && (
                  <span className="block text-xs text-red-400 mt-1" title={email.errorMessage}>
                    {email.errorMessage}
                  </span>
                )}
              </td>
              <td className="text-gray-400 text-sm">
                {fmtDate(tab === 'scheduled' ? email.scheduledAt : email.sentAt ?? email.failedAt)}
              </td>
              <td><StatusBadge status={email.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({
  label, value, icon, color,
}: {
  label: string;
  value: number;
  icon: string;
  color: 'indigo' | 'amber' | 'emerald' | 'red';
}) {
  const colors = {
    indigo: 'stat-indigo',
    amber: 'stat-amber',
    emerald: 'stat-emerald',
    red: 'stat-red',
  };
  return (
    <div className={`stat-card ${colors[color]}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="stat-value">{value.toLocaleString()}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function CampaignStats({ campaigns }: { campaigns: Campaign[] }) {
  const totalSent = campaigns.reduce((sum, campaign) => sum + campaign.sentCount, 0);
  const totalFailed = campaigns.reduce((sum, campaign) => sum + campaign.failedCount, 0);
  const totalQueued = campaigns.reduce(
    (sum, campaign) =>
      sum + Math.max(0, campaign.totalEmails - campaign.sentCount - campaign.failedCount),
    0,
  );

  return (
    <div className="dash-stats">
      <StatCard label="Campaigns" value={campaigns.length} icon="📋" color="indigo" />
      <StatCard label="Queued emails" value={totalQueued} icon="⏳" color="amber" />
      <StatCard label="Sent emails" value={totalSent} icon="✅" color="emerald" />
      <StatCard label="Failed emails" value={totalFailed} icon="❌" color="red" />
    </div>
  );
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>('scheduled');
  const [page, setPage] = useState(1);

  const campaignsQuery = useQuery({
    queryKey: ['campaigns'],
    queryFn: fetchCampaigns,
    refetchInterval: 10_000,
  });
  const emailsQuery = useQuery({
    queryKey: ['emails', activeTab, page],
    queryFn: () => fetchEmails(activeTab, page, 50),
    refetchInterval: 5_000,
  });

  function selectTab(tab: TabId) {
    setActiveTab(tab);
    setPage(1);
  }

  const pageInfo = emailsQuery.data;
  const totalPages = Math.max(1, pageInfo?.totalPages ?? 1);

  return (
    <div className="dash-page">
      <div className="dash-header">
        <div>
          <h1 className="dash-title">Dashboard</h1>
          <p className="dash-sub">Monitor scheduled and sent emails in real time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SlackConnection />
          <Link to="/compose" id="dash-compose-btn" className="btn-primary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Compose New Email
          </Link>
        </div>
      </div>

      {campaignsQuery.isLoading && (
        <div className="dash-loading"><div className="spinner" /><span>Loading campaign stats…</span></div>
      )}
      {campaignsQuery.isError && (
        <div className="dash-error" role="alert">
          Campaign totals could not be loaded.
          <button className="btn-ghost ml-3" onClick={() => void campaignsQuery.refetch()}>Retry</button>
        </div>
      )}
      {campaignsQuery.data && <CampaignStats campaigns={campaignsQuery.data} />}

      <div className="dash-card">
        <div className="dash-tabs" role="tablist" aria-label="Email status">
          {(['scheduled', 'sent'] as const).map((tab) => (
            <button
              key={tab}
              id={`tab-${tab}`}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => selectTab(tab)}
              className={`dash-tab ${activeTab === tab ? 'dash-tab-active' : ''}`}
            >
              {tab === 'scheduled' ? 'Scheduled Emails' : 'Sent Emails'}
              {tab === activeTab && pageInfo ? ` (${pageInfo.total.toLocaleString()})` : ''}
            </button>
          ))}
        </div>

        {emailsQuery.isLoading && (
          <div className="dash-loading"><div className="spinner" /><span>Loading emails…</span></div>
        )}
        {emailsQuery.isError && (
          <div className="dash-error" role="alert">
            Emails could not be loaded.
            <button className="btn-ghost ml-3" onClick={() => void emailsQuery.refetch()}>Retry</button>
          </div>
        )}
        {!emailsQuery.isLoading && !emailsQuery.isError && pageInfo && (
          <>
            <EmailTable emails={pageInfo.emails} tab={activeTab} />
            {pageInfo.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-800 px-5 py-3 text-sm text-gray-400">
                <span>Page {pageInfo.page} of {pageInfo.totalPages}</span>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
