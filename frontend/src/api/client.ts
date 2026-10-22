import axios from 'axios';

/**
 * Shared axios instance.
 * - baseURL uses the public /api route (or VITE_API_URL when explicitly configured).
 * - withCredentials: true sends the session cookie with every request.
 */
const productionBackendUrl = 'https://outboxlabs-emailscheduler-1.onrender.com';

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? `${productionBackendUrl}/api` : '/api')
).replace(/\/$/, '');
export const API_ORIGIN = API_BASE_URL.replace(/\/api$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export default api;
