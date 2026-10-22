import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, loginWithGoogle } from '../hooks/useAuth';

const errorMessages: Record<string, string> = {
  oauth_denied: 'Google login was cancelled. Please try again.',
  session_error: 'Could not create your session. Please try again.',
  server_error: 'An unexpected error occurred. Please try again.',
};

export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const errorCode = searchParams.get('error');

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#030712',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Animated gradient orbs */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: '-20%', right: '-15%',
          width: '600px', height: '600px',
          background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)',
          borderRadius: '50%', animation: 'orb1 8s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: '-20%', left: '-15%',
          width: '500px', height: '500px',
          background: 'radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)',
          borderRadius: '50%', animation: 'orb2 10s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', top: '40%', left: '50%',
          width: '300px', height: '300px',
          background: 'radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 70%)',
          borderRadius: '50%', animation: 'orb3 12s ease-in-out infinite',
        }} />
      </div>

      {/* Grid overlay */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
        maskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, black 40%, transparent 100%)',
      }} />

      <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '420px' }}>
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2.5rem' }}>
          <div style={{
            width: '4.5rem', height: '4.5rem',
            borderRadius: '1.25rem',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 40px rgba(99,102,241,0.4), 0 20px 40px rgba(0,0,0,0.3)',
            marginBottom: '1.25rem',
            animation: 'float 4s ease-in-out infinite',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 style={{
            fontSize: '2rem', fontWeight: 800, margin: '0 0 0.375rem',
            background: 'linear-gradient(135deg, #f9fafb 30%, #a5b4fc 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text', letterSpacing: '-0.03em',
          }}>
            OutboxLabs
          </h1>
          <p style={{ color: '#6b7280', fontSize: '0.9rem', margin: 0 }}>
            Email scheduling at scale
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(12,17,32,0.85)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: '1.25rem',
          padding: '2.25rem',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)',
          backdropFilter: 'blur(20px)',
        }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f9fafb', margin: '0 0 0.375rem', letterSpacing: '-0.01em' }}>
            Welcome back
          </h2>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0 0 1.75rem', lineHeight: 1.5 }}>
            Sign in to manage your email campaigns.
          </p>

          {/* Error banner */}
          {errorCode && (
            <div style={{
              marginBottom: '1.25rem',
              display: 'flex', alignItems: 'flex-start', gap: '0.625rem',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: '0.75rem', padding: '0.875rem 1rem',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" style={{ flexShrink: 0, marginTop: '1px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p style={{ color: '#fca5a5', fontSize: '0.875rem', margin: 0, lineHeight: 1.5 }}>
                {errorMessages[errorCode] ?? 'Something went wrong. Please try again.'}
              </p>
            </div>
          )}

          {/* Google Sign-in button */}
          <button
            id="btn-google-signin"
            onClick={loginWithGoogle}
            disabled={isLoading}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '0.75rem', padding: '0.875rem 1.5rem',
              background: '#ffffff', color: '#111827',
              border: 'none', borderRadius: '0.75rem',
              fontSize: '0.95rem', fontWeight: 600, cursor: isLoading ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              transition: 'all 0.2s ease',
              opacity: isLoading ? 0.6 : 1,
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                (e.target as HTMLButtonElement).style.transform = 'translateY(-1px)';
                (e.target as HTMLButtonElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
              }
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.transform = 'translateY(0)';
              (e.target as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            <span>{isLoading ? 'Checking session…' : 'Continue with Google'}</span>
          </button>

          {/* Features list */}
          <div style={{ marginTop: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {[
              { icon: '📋', text: 'Upload CSV and schedule bulk emails' },
              { icon: '⚡', text: 'Rate limiting & hourly quota control' },
              { icon: '🔔', text: 'Slack notifications on rate limits' },
            ].map(({ icon, text }) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <span style={{ fontSize: '1rem' }}>{icon}</span>
                <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{text}</span>
              </div>
            ))}
          </div>

          <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.75rem', color: '#4b5563' }}>
            By signing in you agree to the terms of this demo assignment.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes orb1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-30px, 20px) scale(1.05); }
        }
        @keyframes orb2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(20px, -30px) scale(1.08); }
        }
        @keyframes orb3 {
          0%, 100% { transform: translate(-50%, 0) scale(1); }
          50% { transform: translate(-50%, -20px) scale(1.1); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
