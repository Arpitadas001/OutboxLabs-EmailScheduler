import { useQuery } from '@tanstack/react-query';
import api, { API_ORIGIN } from '../api/client';

export interface User {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  slackUserId: string | null;
  slackTeamId: string | null;
  createdAt: string;
}

/**
 * useAuth — fetch the current user profile from GET /auth/me.
 *
 * Why React Query?
 *   - Handles loading/error states automatically.
 *   - Caches the result so every component can call useAuth() without
 *     triggering multiple requests.
 *   - retry: false — a 401 means the user is genuinely not logged in,
 *     so we shouldn't retry (it will never succeed without a login).
 */
export function useAuth() {
  const { data, isLoading, isError, error } = useQuery<User>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await api.get<User>('/auth/me');
      return res.data;
    },
    retry: false,
    staleTime: 5 * 60 * 1000, // re-validate at most once every 5 minutes
  });

  const isAuthenticated = !isLoading && !isError && !!data;

  return { user: data, isLoading, isError, error, isAuthenticated };
}

/**
 * Trigger Google OAuth login by redirecting the browser to the backend's
 * /auth/google endpoint.  This is a full-page navigation (not an XHR) because
 * Google's OAuth redirect goes to the backend, not the frontend.
 */
export function loginWithGoogle() {
  window.location.href = `${API_ORIGIN}/auth/google`;
}

/**
 * Logout by navigating to /auth/logout (backend destroys session + redirects).
 */
export function logout() {
  window.location.href = `${API_ORIGIN}/auth/logout`;
}
