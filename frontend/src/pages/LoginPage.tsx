import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, loginWithGoogle } from '../hooks/useAuth';

/**
 * LoginPage — shown to unauthenticated users.
 *
 * What it does:
 *   1. Calls useAuth() — if the user already has a valid session they're
 *      redirected to the dashboard immediately (handles back-button case).
 *   2. Shows error messages from the OAuth callback (e.g. oauth_denied).
 *   3. "Sign in with Google" is a full-page redirect to /auth/google on the
 *      backend, which then redirects to Google's consent screen.
 *
 * Why a full-page redirect (not a popup)?
 *   Popups are blocked by default in most browsers for cross-origin flows.
 *   A server-side redirect is more reliable and easier to explain in an interview.
 */
export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const errorCode = searchParams.get('error');

  const errorMessages: Record<string, string> = {
    oauth_denied: 'Google login was cancelled. Please try again.',
    session_error: 'Could not create your session. Please try again.',
    server_error: 'An unexpected error occurred. Please try again.',
  };

  // Already logged in? Go straight to the dashboard.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4">
      {/* Background gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-indigo-500/30 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">OutboxLabs</h1>
          <p className="text-gray-400 text-sm">Email scheduling at scale</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-2">Welcome back</h2>
          <p className="text-gray-400 text-sm mb-8">
            Sign in to manage your email campaigns.
          </p>

          {/* Error banner */}
          {errorCode && (
            <div className="mb-6 flex items-start gap-3 bg-red-900/30 border border-red-500/30 rounded-xl p-4">
              <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-red-300 text-sm">
                {errorMessages[errorCode] ?? 'Something went wrong. Please try again.'}
              </p>
            </div>
          )}

          {/* Google Sign-in button */}
          <button
            id="btn-google-signin"
            onClick={loginWithGoogle}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white hover:bg-gray-50 text-gray-900 font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {/* Google "G" SVG */}
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            <span>{isLoading ? 'Checking session…' : 'Continue with Google'}</span>
          </button>

          <p className="mt-6 text-center text-xs text-gray-500">
            By signing in you agree to the terms of this demo assignment.
          </p>
        </div>
      </div>
    </div>
  );
}
