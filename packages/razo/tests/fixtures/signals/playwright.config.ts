import { defineConfig } from '@playwright/test';

// Run as a child process by tests/signals.spec.ts, which reads the
// razo-steps.json the reporter writes into RAZO_SIGNALS_OUT.
export default defineConfig({
  testDir: '.',
  testMatch: '*.fixture.ts',
  reporter: [['../../../src/reporting/AiReporter.ts', { outputDir: process.env.RAZO_SIGNALS_OUT }]],
  expect: { timeout: 1_000 },
});
