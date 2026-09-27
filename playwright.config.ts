import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: process.env.WEB_URL ?? 'http://localhost:3000' },
});
