import { defineConfig } from '@playwright/test';
import { browserLaunchOptions } from './scripts/lib/browser';
export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4318',
    headless: true,
    viewport: { width: 1440, height: 980 },
    launchOptions: browserLaunchOptions(),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${process.execPath} --import tsx scripts/test-server.ts`,
    url: 'http://127.0.0.1:4318/healthz',
    reuseExistingServer: false,
    timeout: 20_000,
  },
  reporter: [['list']],
});
