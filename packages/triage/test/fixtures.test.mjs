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

describe('razo-demo-pr-1', () => {
  const dir = path.join(FIXTURES, 'razo-demo-pr-1');
  test('has a green base run on main and a red PR run with the two expected failures', async () => {
    const runs = await new RazoSource(dir).fetchRuns(new Date(0));
    assert.equal(runs.length, 2);
    const [green, red] = runs;
    assert.equal(green.branch, 'main');
    assert.equal(green.results.filter((r) => r.status !== 'passed').length, 0);
    assert.equal(red.branch, 'main', 'the PR head is captured as a main run: it is what merging would have made red');
    assert.deepEqual(
      red.results.filter((r) => r.status === 'failed').map((r) => r.title).sort(),
      ['placing the order confirms it', 'the cart lists both items'],
    );
    assert.notEqual(green.sha, red.sha);
    const order = red.results.find((r) => r.title === 'placing the order confirms it');
    assert.ok(order.touchedComponents.includes('button "Place order"'));
    assert.ok(order.controls.some((c) => c.selector === '[data-testid="place-order"]'));
  });
  test('commits.json starts at the green sha, ends at the red sha and carries the checkout-page patch', async () => {
    const commits = JSON.parse(fs.readFileSync(path.join(dir, 'commits.json'), 'utf8'));
    const [green, red] = await new RazoSource(dir).fetchRuns(new Date(0));
    // Topological order, as git walks it. Author dates are not monotonic here: the PR
    // commit was authored before the merge-base commit, which is normal after a rebase.
    assert.equal(commits[0].sha, green.sha);
    assert.equal(commits[commits.length - 1].sha, red.sha);
    for (const c of commits) assert.ok(!Number.isNaN(Date.parse(c.date)), c.sha);
    const change = commits.find((c) => c.files.some((f) => f.filename === 'tests/checkout-page.ts'));
    assert.ok(change, 'the commit touching checkout-page.ts');
    assert.match(change.files.find((f) => f.filename === 'tests/checkout-page.ts').patch, /place-order/);
  });
});

