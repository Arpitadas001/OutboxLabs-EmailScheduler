import { Outlet, Link, NavLink } from 'react-router-dom';
import { API_BASE_URL } from '../../api/client';
import UserAvatar from './UserAvatar';

const NAV_ITEMS = [
  { to: '/', end: true, label: 'Dashboard', icon: '◈' },
  { to: '/compose', end: false, label: 'Compose', icon: '✦' },
  { to: '/search', end: false, label: 'Search', icon: '⌕' },
  { to: '/health', end: false, label: 'Health', icon: '◉' },
];

export default function AppShell() {
  return (
    <div style={{ minHeight: '100vh', background: '#030712', display: 'flex', flexDirection: 'column' }}>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: 'rgba(3,7,18,0.8)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 1px 0 rgba(255,255,255,0.04)',
      }}>
        <div style={{
          maxWidth: '80rem', margin: '0 auto',
          padding: '0 1.5rem',
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', height: '3.75rem',
          gap: '1rem',
        }}>
          {/* Logo */}
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', textDecoration: 'none' }}>
            <div style={{
              width: '2rem', height: '2rem', borderRadius: '0.5rem',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 12px rgba(99,102,241,0.35)',
              flexShrink: 0,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span style={{
              fontSize: '1.05rem', fontWeight: 800,
              background: 'linear-gradient(135deg, #f9fafb 30%, #a5b4fc 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text', letterSpacing: '-0.02em',
            }}>
              OutboxLabs
            </span>
          </Link>

          {/* Nav */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '0.125rem' }}>
            {NAV_ITEMS.map(({ to, end, label }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                style={({ isActive }) => ({
                  padding: '0.45rem 0.875rem',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                  fontWeight: isActive ? 600 : 500,
                  textDecoration: 'none',
                  transition: 'all 0.15s ease',
                  color: isActive ? '#a5b4fc' : '#9ca3af',
                  background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                  border: isActive ? '1px solid rgba(99,102,241,0.25)' : '1px solid transparent',
                })}
              >
                {label}
              </NavLink>
            ))}
            <a
              href={`${API_BASE_URL}/admin/queues`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '0.45rem 0.875rem', borderRadius: '0.5rem',
                fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none',
                color: '#9ca3af', border: '1px solid transparent',
                transition: 'all 0.15s ease', display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#e5e7eb'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#9ca3af'; }}
            >
              Queues
              <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" style={{ opacity: 0.5 }}>
                <path d="M3.5 3a.5.5 0 000 1H7.3L2.15 9.15a.5.5 0 00.7.7L8 4.7V8.5a.5.5 0 001 0V3a.5.5 0 00-.5-.5H3.5z"/>
              </svg>
            </a>
          </nav>

          {/* User */}
          <UserAvatar />
        </div>
      </header>

      {/* ── Page content ──────────────────────────────────────────────── */}
      <main style={{
        flex: 1, maxWidth: '80rem', width: '100%',
        margin: '0 auto', padding: '2rem 1.5rem',
        position: 'relative', zIndex: 1,
      }}>
        <Outlet />
      </main>
    </div>
  );
}
