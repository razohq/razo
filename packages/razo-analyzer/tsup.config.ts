import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'upload-cli': 'src/upload-cli.ts',
  },
  format: ['cjs'],
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: ['@anthropic-ai/sdk'],
});
