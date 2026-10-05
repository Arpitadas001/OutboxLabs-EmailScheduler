import axios from 'axios';

/**
 * Shared axios instance.
 * - baseURL points to the backend (port 3001).
 * - withCredentials: true — sends the session cookie on every request,
 *   even though the frontend origin (port 3000) differs from the backend (port 3001).
 *   This is what makes server-side sessions work in a cross-origin Vite dev setup.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001',
  withCredentials: true,
});

export default api;
