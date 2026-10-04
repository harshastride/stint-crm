import { defineConfig } from '@playwright/test';

// End-to-end checks of the main flows in a real browser. Needs Supabase running with demo data
// (supabase start; npm run seed). Starts the app on port 3100 if it is not already running.
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3100', viewport: { width: 1400, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:3100/login', reuseExistingServer: true, timeout: 120_000 },
});
