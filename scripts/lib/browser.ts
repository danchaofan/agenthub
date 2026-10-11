import { existsSync } from 'node:fs';
import type { LaunchOptions } from '@playwright/test';

// Prefer an explicitly selected browser; otherwise use installed Mac Chrome or Playwright Chromium.
export function browserLaunchOptions(): LaunchOptions {
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath =
    process.env.AGENTHUB_CHROME ??
    (process.platform === 'darwin' && existsSync(macChrome) ? macChrome : undefined);
  return {
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ['--disable-dev-shm-usage'],
  };
}
