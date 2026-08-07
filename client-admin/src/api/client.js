import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({ baseURL: `${API_URL}/api`, timeout: 30_000 });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('sv_admin_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if ([401, 403].includes(error.response?.status)) {
      localStorage.removeItem('sv_admin_token');
      onUnauthorized?.();
    }
    error.userMessage =
      error.response?.data?.error ||
      (error.request && !error.response
        ? 'Cannot reach the API server. Is it running?'
        : 'Something went wrong.');
    // Surface field-level validation messages from zod.
    if (error.response?.data?.details) {
      error.userMessage +=
        ': ' + error.response.data.details.map((d) => `${d.field} — ${d.message}`).join(', ');
    }
    return Promise.reject(error);
  }
);

export const fileUrl = (p) => (p?.startsWith('http') ? p : `${API_URL}${p}`);

/**
 * Downloads a file from an authenticated endpoint. A plain <a href> can't send
 * the bearer token, so fetch it as a blob and click a temporary link.
 */
export async function downloadFile(path, params, fallbackName) {
  const { data, headers } = await api.get(path, { params, responseType: 'blob' });

  const disposition = headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const name = match?.[1] || fallbackName;

  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default api;
