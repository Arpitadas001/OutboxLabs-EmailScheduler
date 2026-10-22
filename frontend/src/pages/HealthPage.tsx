import { useQuery } from '@tanstack/react-query';
import api from '../api/client';

interface DepsHealth {
  postgres: string;
  redis: string;
  elasticsearch: string;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
        ok ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]'
      }`}
    />
  );
}

export default function HealthPage() {
  const depsQuery = useQuery<DepsHealth>({
    queryKey: ['health', 'dependencies'],
    queryFn: async () => {
      const res = await api.get<DepsHealth>('/health/dependencies');
      return res.data;
    },
    refetchInterval: 15_000,
    retry: false,
  });

  const health = depsQuery.data;

  const services = health
    ? [
        { name: 'PostgreSQL', status: health.postgres, icon: '🗄️' },
        { name: 'Redis', status: health.redis, icon: '⚡' },
        { name: 'Elasticsearch', status: health.elasticsearch, icon: '🔍' },
      ]
    : [];

  const allOk = health
    ? Object.values(health).every((v) => v === 'ok')
    : false;

  return (
    <div className="dash-page">
      <div className="dash-header">
        <div>
          <h1 className="dash-title">System Health</h1>
          <p className="dash-sub">Real-time status of all backend dependencies.</p>
        </div>
        <button
          className="btn-ghost"
          onClick={() => void depsQuery.refetch()}
          disabled={depsQuery.isFetching}
        >
          {depsQuery.isFetching ? (
            <>
              <div className="spinner-sm" /> Refreshing…
            </>
          ) : (
            '↻ Refresh'
          )}
        </button>
      </div>

      {/* Overall status banner */}
      {health && (
        <div
          className={`flex items-center gap-3 px-5 py-4 rounded-xl border ${
            allOk
              ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-300'
              : 'bg-red-900/20 border-red-500/30 text-red-300'
          }`}
        >
          <span className="text-2xl">{allOk ? '✅' : '⚠️'}</span>
          <span className="font-semibold">
            {allOk ? 'All systems operational' : 'One or more dependencies are degraded'}
          </span>
        </div>
      )}

      {/* Service cards */}
      <div className="dash-stats">
        {depsQuery.isLoading && (
          <div className="dash-loading">
            <div className="spinner" />
            <span>Checking dependencies…</span>
          </div>
        )}
        {depsQuery.isError && (
          <div className="dash-error" role="alert">
            Could not reach the health endpoint.{' '}
            <button className="btn-ghost ml-3" onClick={() => void depsQuery.refetch()}>
              Retry
            </button>
          </div>
        )}
        {services.map((svc) => {
          const ok = svc.status === 'ok';
          return (
            <div
              key={svc.name}
              className={`stat-card ${ok ? 'stat-emerald' : 'stat-red'}`}
              style={{ gap: '0.75rem' }}
            >
              <span style={{ fontSize: '1.75rem' }}>{svc.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <StatusDot ok={ok} />
                  <span className="stat-value" style={{ fontSize: '1rem' }}>
                    {svc.name}
                  </span>
                </div>
                <div className="stat-label mt-1">
                  {ok ? 'Connected & healthy' : `Degraded: ${svc.status}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Architecture reference */}
      <div className="dash-card">
        <div className="dash-tabs">
          <span className="dash-tab dash-tab-active">Service Architecture</span>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))',
              gap: '1rem',
            }}
          >
            {[
              { icon: '⚛️', name: 'React + Vite', role: 'Frontend', port: '3000' },
              { icon: '🚀', name: 'Express + TypeScript', role: 'API Server', port: '3001' },
              { icon: '🔧', name: 'BullMQ Worker', role: 'Job Processor', port: 'in-process' },
              { icon: '🗄️', name: 'PostgreSQL', role: 'Primary Database', port: '5432' },
              { icon: '⚡', name: 'Redis', role: 'Queue + Sessions', port: '6379' },
              { icon: '🔍', name: 'Elasticsearch', role: 'Email Search', port: '9200' },
              { icon: '📬', name: 'Ethereal SMTP', role: 'Test Email Sending', port: '587' },
              { icon: '📋', name: 'Bull Board', role: 'Queue Dashboard', port: '/admin/queues' },
            ].map((svc) => (
              <div
                key={svc.name}
                style={{
                  padding: '1rem',
                  borderRadius: '0.625rem',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{svc.icon}</div>
                <div
                  style={{
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: '#f3f4f6',
                    marginBottom: '0.25rem',
                  }}
                >
                  {svc.name}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{svc.role}</div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: '#6b7280',
                    marginTop: '0.25rem',
                    fontFamily: 'monospace',
                  }}
                >
                  :{svc.port}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
