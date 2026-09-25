#!/usr/bin/env node
// Regenerates synthetic-flaky and synthetic-environment.
//   node fixtures/generator/generate.mjs
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const triage = path.resolve(here, '../..');
const SHA = '1111111111111111111111111111111111111111'; // synthetic: no real commit behind it

for (const scenario of ['flaky', 'environment']) {
  fs.rmSync(path.join(here, 'test-results'), { recursive: true, force: true });
  try {
    execFileSync('npx', ['playwright', 'test', '-c', path.join(here, 'playwright.config.ts')], {
      cwd: triage, stdio: 'inherit', env: { ...process.env, RAZO_GEN_SCENARIO: scenario },
    });
  } catch { /* the environment run is meant to fail */ }
  const out = path.join(triage, 'fixtures', `synthetic-${scenario}`);
  fs.rmSync(out, { recursive: true, force: true });
  execFileSync('node', [
    path.join(triage, 'scripts/capture-run.mjs'), path.join(here, 'test-results'),
    '--data-dir', out, '--id', `synthetic-${scenario}-1`, '--sha', SHA, '--branch', 'main',
    '--started', '2026-09-23T22:00:00Z', '--finished', '2026-09-23T22:03:00Z', '--synthetic',
  ], { stdio: 'inherit' });
  fs.writeFileSync(path.join(out, 'README.md'), `# synthetic-${scenario}

SYNTHETIC. Produced by \`fixtures/generator\` with razo's real reporter:
${scenario === 'flaky'
  ? 'one test fails on its first attempt (wrong testid, healing off) and passes on retry.'
  : 'five spec files navigate to a closed port and fail together with a connection error.'}
The sha is a placeholder; there is no commit behind it. \`run.json\` carries
\`"synthetic": true\`.
`);
}
fs.rmSync(path.join(here, 'test-results'), { recursive: true, force: true });
fs.rmSync(path.join(here, 'playwright-report'), { recursive: true, force: true });
