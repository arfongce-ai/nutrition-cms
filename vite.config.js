import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { onRequestGet as nutritionUpdates } from './functions/api/nutrition-updates.js';

export default defineConfig({
  plugins: [react(), {
    name: 'local-nutrition-updates',
    configureServer(server) {
      server.middlewares.use('/api/nutrition-updates', async (req, res) => {
        try {
          const response = await nutritionUpdates({ request: new Request('http://localhost/api/nutrition-updates') });
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
        } catch { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '자료 연결 실패' })); }
      });
    },
  }],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
