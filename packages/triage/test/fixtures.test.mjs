import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RazoSource, readRuns, errorSignature } from '../dist/index.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const scenarios = fs.readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(FIXTURES, d.name, 'runs')))
  .map((d) => d.name);

describe('every fixture scenario loads through RazoSource', () => {
  assert.ok(scenarios.length > 0, 'fixtures directory has scenarios');
  for (const scenario of scenarios) {
    test(`${scenario}: has a README and runs whose results all carry a testId, attempts and signed errors`, async () => {
      assert.ok(fs.existsSync(path.join(FIXTURES, scenario, 'README.md')), 'README.md');
      const runs = await new RazoSource(path.join(FIXTURES, scenario)).fetchRuns(new Date(0));
      assert.ok(runs.length >= 1);
      for (const run of runs) {
        assert.ok(run.results.length > 0, `${run.id} has no results`);
        for (const r of run.results) {
          assert.ok(r.testId.includes('::'));
          assert.ok(r.attempts.length >= 1);
          if (r.error) assert.equal(r.error.signature, errorSignature(r.error.message));
        }
      }
    });
    test(`${scenario}: is marked synthetic in run.json exactly when its name says so`, () => {
      for (const { manifest } of readRuns(path.join(FIXTURES, scenario))) {
        assert.equal(manifest.synthetic === true, scenario.startsWith('synthetic-'), manifest.id);
      }
    });
  }
});

describe('razo-suite', () => {
  test('is one run of the razo package suite with its one deliberate failure and healed steps', async () => {
    const [run] = await new RazoSource(path.join(FIXTURES, 'razo-suite')).fetchRuns(new Date(0));
    assert.equal(run.results.length, 45);
    assert.equal(run.results.filter((r) => r.status === 'failed').length, 1);
    assert.ok(run.results.some((r) => r.healedLocators?.length));
  });
});

describe('cloud-examples', () => {
  test('is three runs, one per example, each with exactly one failed test', async () => {
    const runs = await new RazoSource(path.join(FIXTURES, 'cloud-examples')).fetchRuns(new Date(0));
    assert.deepEqual(runs.map((r) => r.id).sort(), ['failing-button', 'failing-table', 'table-row-actions']);
    for (const run of runs) assert.equal(run.results.filter((r) => r.status === 'failed').length, 1, run.id);
  });
});
