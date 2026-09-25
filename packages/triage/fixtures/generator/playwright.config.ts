import { defineConfig } from '@playwright/test';

/**
 * Produces the synthetic fixtures. `retries: 2` so the flaky spec gets a
 * second attempt; short timeouts so the environment specs fail fast.
 * Run through generate.mjs, which sets RAZO_GEN_SCENARIO.
 */
export default defineConfig({
  testDir: './tests',
  retries: 2,
  workers: 1,
  reporter: [['list'], ['@razohq/razo/reporter']],
  expect: { timeout: 2_000 },
  use: { actionTimeout: 2_000 },
  timeout: 15_000,
  grep: process.env.RAZO_GEN_SCENARIO === 'environment' ? /@environment/ : /@flaky/,
});
