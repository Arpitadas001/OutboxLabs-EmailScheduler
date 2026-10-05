import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface Props {
  children: React.ReactNode;
}

/**
 * ProtectedRoute — wraps any route that requires authentication.
 *
 * While the auth state is loading (first render), show a spinner.
 * If the user is not authenticated (401 from /auth/me), redirect to /login.
 * If authenticated, render children normally.
 *
 * We pass the current location in the redirect state so the login page
 * could later restore the user's intended destination (progressive enhancement).
 */
export default function ProtectedRoute({ children }: Props) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Checking session…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
