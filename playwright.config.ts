import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  reporter: 'list', timeout: 30_000,
  use: { baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:4318', trace:'retain-on-failure' },
  projects: [{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer: process.env.TEST_BASE_URL ? undefined : {
    command: 'PORT=4318 HOST=127.0.0.1 DATA_DIR=/root/.hermes/cache/scratch/garisbola-e2e-data npm run dev',
    url:'http://127.0.0.1:4318/healthz', reuseExistingServer:false, timeout:45_000,
  },
});
