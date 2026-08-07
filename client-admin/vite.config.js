import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Different port from the staff app so both can run on the same machine.
  // strictPort: fail loudly if 5174 is taken rather than drifting to 5175 —
  // the API's CORS_ORIGINS only allows 5173 and 5174, so a drifted port serves
  // a page that looks fine but has every API call blocked.
  server: { host: true, port: 5174, strictPort: true },
  preview: { host: true, port: 5174, strictPort: true },
});
