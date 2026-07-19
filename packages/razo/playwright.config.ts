import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['html', { open: 'never' }], ['list'], ['./src/reporting/AiReporter.ts']],
  // Action/assertion timeouts below the test timeout: a hanging action
  // fails inside its step (emitting its 'failed' StepEvent) instead of
  // killing the whole test with no narration.
  expect: { timeout: 3_000 },
  use: {
    actionTimeout: 5_000,
    trace: 'retain-on-failure',
  },
});
