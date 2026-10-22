import { defineConfig, devices } from '@playwright/test';

export default defineConfig({ testDir: './e2e', reporter: 'list', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3001', screenshot: 'only-on-failure' }, webServer: { command: 'npm start', port: 3001, env: { PORT: '3001' }, reuseExistingServer: false } });
