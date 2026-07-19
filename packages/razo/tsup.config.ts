import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    reporter: 'src/reporter.ts',
    vite: 'src/vite.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: ['@playwright/test', '@playwright/test/reporter', 'vite'],
});
