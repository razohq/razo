import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    contract: 'src/contract.ts',
    fakes: 'src/fakes.ts',
    cli: 'src/cli.ts',
  },
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: ['fflate', 'js-yaml'],
});
