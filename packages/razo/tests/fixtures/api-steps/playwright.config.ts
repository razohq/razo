import { defineConfig } from '@playwright/test';

// Run as a child process by tests/masking.spec.ts, which reads the step titles
// printed by titles-reporter.ts to see the titles Playwright itself gives its API calls.
export default defineConfig({
  testDir: '.',
  testMatch: '*.fixture.ts',
  reporter: './titles-reporter.ts',
});
