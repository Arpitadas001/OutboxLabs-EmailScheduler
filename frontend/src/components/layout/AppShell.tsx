import { Outlet, Link, NavLink } from 'react-router-dom';
import UserAvatar from './UserAvatar';

/**
 * AppShell — the authenticated app frame.
 *
 * Layout:
 *   - Top bar: logo · nav links · UserAvatar (name + picture + logout)
 *   - Main: <Outlet /> renders the active page
 *
 * Only rendered inside ProtectedRoute so we can safely assume a session exists.
 */
export default function AppShell() {
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
      isActive
        ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
        : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800',
    ].join(' ');

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-gray-900/80 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/40 transition-shadow">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                OutboxLabs
              </span>
            </Link>

            {/* Nav */}
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={navLinkClass}>Dashboard</NavLink>
              <NavLink to="/compose" className={navLinkClass}>Compose</NavLink>
              <NavLink to="/health" className={navLinkClass}>Health</NavLink>
            </nav>

            {/* User info + logout */}
            <UserAvatar />
          </div>
        </div>
      </header>

      {/* ── Page content ─────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
