import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { fetchCampaigns, type Campaign, type CampaignStatus } from '../api/campaigns';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: CampaignStatus) {
  const config: Record<CampaignStatus, { label: string; cls: string }> = {
    SCHEDULED: { label: 'Scheduled', cls: 'badge-scheduled' },
    RUNNING:   { label: 'Running',   cls: 'badge-running'   },
    COMPLETED: { label: 'Completed', cls: 'badge-completed' },
    PAUSED:    { label: 'Paused',    cls: 'badge-paused'    },
    DRAFT:     { label: 'Draft',     cls: 'badge-draft'     },
    FAILED:    { label: 'Failed',    cls: 'badge-failed'    },
    CANCELLED: { label: 'Cancelled', cls: 'badge-draft'     },
  };
  const { label, cls } = config[status] ?? { label: status, cls: 'badge-draft' };
  return <span className={`badge ${cls}`}>{label}</span>;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: 'scheduled' | 'sent' }) {
  return (
    <div className="dash-empty">
      <div className="dash-empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
          />
        </svg>
      </div>
      <p className="dash-empty-title">
        {tab === 'scheduled' ? 'No scheduled campaigns yet' : 'No completed campaigns yet'}
      </p>
      <p className="dash-empty-sub">
        {tab === 'scheduled'
          ? 'Create your first campaign to get started.'
          : 'Completed campaigns will appear here once emails are sent.'}
      </p>
      {tab === 'scheduled' && (
        <Link to="/compose" className="dash-empty-cta">
          Create Campaign
        </Link>
      )}
    </div>
  );
}

function ScheduledTable({ campaigns }: { campaigns: Campaign[] }) {
  if (campaigns.length === 0) return <EmptyState tab="scheduled" />;
  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Subject</th>
            <th>Status</th>
            <th>Start</th>
            <th className="text-right">Recipients</th>
            <th className="text-right">Sent</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td className="font-medium text-gray-100">{c.name}</td>
              <td className="text-gray-400 truncate max-w-xs">{c.subject}</td>
              <td>{statusBadge(c.status)}</td>
              <td className="text-gray-400 text-sm">{fmtDate(c.startAt)}</td>
              <td className="text-right text-gray-300">{c.totalEmails.toLocaleString()}</td>
              <td className="text-right text-emerald-400">{c.sentCount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SentTable({ campaigns }: { campaigns: Campaign[] }) {
  if (campaigns.length === 0) return <EmptyState tab="sent" />;
  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Subject</th>
            <th className="text-right">Total</th>
            <th className="text-right">Sent</th>
            <th className="text-right">Failed</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td className="font-medium text-gray-100">{c.name}</td>
              <td className="text-gray-400 truncate max-w-xs">{c.subject}</td>
              <td className="text-right text-gray-300">{c.totalEmails.toLocaleString()}</td>
              <td className="text-right text-emerald-400">{c.sentCount.toLocaleString()}</td>
              <td className="text-right text-red-400">{c.failedCount.toLocaleString()}</td>
              <td className="text-gray-400 text-sm">{fmtDate(c.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type TabId = 'scheduled' | 'sent';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>('scheduled');

  const { data: campaigns = [], isLoading, isError } = useQuery({
    queryKey: ['campaigns'],
    queryFn: fetchCampaigns,
    refetchInterval: 10_000, // live polling — refreshes every 10 s
  });

  const scheduled = campaigns.filter(
    (c) => c.status === 'SCHEDULED' || c.status === 'RUNNING' || c.status === 'PAUSED',
  );
  const sent = campaigns.filter(
    (c) => c.status === 'COMPLETED' || c.status === 'FAILED' || c.status === 'CANCELLED',
  );

  // ── Stats bar ──────────────────────────────────────────────────────────────
  const totalSent    = campaigns.reduce((s, c) => s + c.sentCount, 0);
  const totalFailed  = campaigns.reduce((s, c) => s + c.failedCount, 0);
  const totalQueued  = campaigns.reduce((s, c) => s + Math.max(0, c.totalEmails - c.sentCount - c.failedCount), 0);

  return (
    <div className="dash-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="dash-header">
        <div>
          <h1 className="dash-title">Dashboard</h1>
          <p className="dash-sub">Monitor your email campaigns in real-time.</p>
        </div>
        <Link to="/compose" id="dash-compose-btn" className="btn-primary">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Campaign
        </Link>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <div className="dash-stats">
        <StatCard label="Total Campaigns" value={campaigns.length} icon="📋" color="indigo" />
        <StatCard label="Queued" value={totalQueued} icon="⏳" color="amber" />
        <StatCard label="Sent" value={totalSent} icon="✅" color="emerald" />
        <StatCard label="Failed" value={totalFailed} icon="❌" color="red" />
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="dash-card">
        <div className="dash-tabs">
          {(['scheduled', 'sent'] as TabId[]).map((tab) => (
            <button
              key={tab}
              id={`tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={`dash-tab ${activeTab === tab ? 'dash-tab-active' : ''}`}
            >
              {tab === 'scheduled' ? `Scheduled (${scheduled.length})` : `Sent (${sent.length})`}
            </button>
          ))}
        </div>

        {/* ── Content ─────────────────────────────────────────────────── */}
        {isLoading && (
          <div className="dash-loading">
            <div className="spinner" />
            <span>Loading campaigns…</span>
          </div>
        )}

        {isError && (
          <div className="dash-error">
            <span>⚠️ Failed to load campaigns. The backend may be down.</span>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            {activeTab === 'scheduled' && <ScheduledTable campaigns={scheduled} />}
            {activeTab === 'sent'      && <SentTable campaigns={sent} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, color,
}: {
  label: string; value: number; icon: string; color: 'indigo' | 'amber' | 'emerald' | 'red';
}) {
  const colors = {
    indigo:  'stat-indigo',
    amber:   'stat-amber',
    emerald: 'stat-emerald',
    red:     'stat-red',
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
