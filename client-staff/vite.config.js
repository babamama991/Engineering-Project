import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // host:true binds 0.0.0.0 so phones on the same wifi can open the dev server.
    host: true,
    port: 5173,
    // Fail loudly if 5173 is taken instead of silently moving to 5174/5175.
    // The API's CORS_ORIGINS only allows 5173 and 5174, so a drifted port
    // serves a page that looks fine but has every API call blocked.
    strictPort: true,
  },
  preview: { host: true, port: 5173, strictPort: true },
});
