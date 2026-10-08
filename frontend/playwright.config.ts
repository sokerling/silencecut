import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const browserCandidates = process.platform === 'darwin'
  ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
  : ['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];

const browserPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? browserCandidates.find((candidate) => existsSync(candidate));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.VIDEOEDITOR_E2E_FRONTEND_URL ?? 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 1100 },
    headless: true,
    launchOptions: browserPath ? { executablePath: browserPath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
