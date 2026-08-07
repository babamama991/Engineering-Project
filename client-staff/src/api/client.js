import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 20_000,
});

// Attach the token to every request.
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('sv_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// One place to react to auth failures.
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

api.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      localStorage.removeItem('sv_token');
      onUnauthorized?.(status);
    }
    // Normalise the message so components never dig through axios internals.
    error.userMessage =
      error.response?.data?.error ||
      (error.code === 'ECONNABORTED'
        ? 'The server took too long to answer. Check your connection.'
        : error.request && !error.response
          ? 'Cannot reach the server. Are you on the hotel wifi?'
          : 'Something went wrong. Please try again.');
    return Promise.reject(error);
  }
);

/** Absolute URL for a photo path returned by the API. */
export const fileUrl = (p) => (p?.startsWith('http') ? p : `${API_URL}${p}`);

export default api;
