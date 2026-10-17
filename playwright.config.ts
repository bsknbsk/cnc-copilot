import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const audioFixture = path.resolve('e2e/fixtures/question.wav');

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: {
    timeout: 30000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${audioFixture}`,
      ],
    },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: {
        channel: 'chrome',
        launchOptions: {
          ignoreDefaultArgs: ['--enable-automation'],
          args: [
            '--disable-blink-features=AutomationControlled',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      },
    },
    {
      name: 'chromium',
      testMatch: /(agent|academy-data)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/state.json',
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${audioFixture}`,
          ],
        },
      },
      dependencies: ['setup'],
    },
  ],
});
