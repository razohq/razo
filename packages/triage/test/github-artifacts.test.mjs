import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { GitHubApi, pullGithubArtifacts, reportsFromZip, readRuns } from '../dist/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gh-artifacts-'));
const report = (test, status, extra = {}) => ({ test, file: 'tests/checkout.spec.ts', status, durationMs: 5, steps: [], ...extra });

function zipOf(entries) {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([p, v]) => [p, strToU8(typeof v === 'string' ? v : JSON.stringify(v))]))));
}

const RUN = (id, over = {}) => ({
  id, run_attempt: 1, status: 'completed', conclusion: 'failure', event: 'schedule',
  head_sha: String(id).padEnd(40, '0'), head_branch: 'main', run_started_at: `2026-09-2${id % 10}T03:00:00Z`, updated_at: `2026-09-2${id % 10}T03:04:00Z`,
  html_url: `https://github.com/o/r/actions/runs/${id}`, pull_requests: [], ...over,
});

/** Fake GitHub Actions: runs, their artifacts and the zips. */
function fakeActions({ runs, artifacts, zips }) {
  const calls = [];
  const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, arrayBuffer: async () => body });
  const fetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (/\/actions\/runs\/\d+\/artifacts$/.test(u.pathname)) {
      const id = Number(u.pathname.match(/runs\/(\d+)/)[1]);
      return ok({ total_count: (artifacts[id] ?? []).length, artifacts: artifacts[id] ?? [] });
    }
    if (/\/actions\/artifacts\/\d+\/zip$/.test(u.pathname)) {
      const id = Number(u.pathname.match(/artifacts\/(\d+)/)[1]);
      const zip = zips[id];
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) };
    }
    if (/\/actions\/(workflows\/[^/]+\/)?runs$/.test(u.pathname)) {
      const page = Number(u.searchParams.get('page') ?? 1);
      const perPage = Number(u.searchParams.get('per_page') ?? 100);
      const branch = u.searchParams.get('branch');
      const filtered = runs.filter((r) => !branch || r.head_branch === branch);
      return ok({ total_count: filtered.length, workflow_runs: filtered.slice((page - 1) * perPage, page * perPage) });
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ message: 'Not Found' }), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, calls };
}

test('reportsFromZip finds every razo-steps.json with its retry index and ignores other files', () => {
  const zip = zipOf({
    'checkout-pays/razo-steps.json': report('pays', 'failed'),
    'checkout-pays-retry1/razo-steps.json': report('pays', 'passed'),
    'checkout-pays/error-context.md': '# ctx',
    'checkout-other/razo-steps.json': report('other', 'passed', { retry: 3 }),
  });
  const found = reportsFromZip(zip).sort((a, b) => a.report.test.localeCompare(b.report.test) || a.retry - b.retry);
  assert.deepEqual(found.map((f) => [f.report.test, f.retry]), [['other', 3], ['pays', 0], ['pays', 1]]);
});

test('pull materializes completed runs with a matching artifact into the layout', async () => {
  const dataDir = tmp();
  const zips = { 501: zipOf({ 'checkout-pays/razo-steps.json': report('pays', 'failed', { error: 'boom' }) }) };
  const { fetch, calls } = fakeActions({
    runs: [RUN(1, { pull_requests: [{ number: 7 }] })],
    artifacts: { 1: [{ id: 501, name: 'razo-test-results-1-1', expired: false }, { id: 502, name: 'other', expired: false }] },
    zips,
  });
  const summary = await pullGithubArtifacts({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', dataDir, since: new Date('2026-09-01T00:00:00Z') });
  assert.deepEqual(summary, { pulled: ['gh-1-1'], skipped: [] });
  const [run] = readRuns(dataDir);
  assert.equal(run.manifest.id, 'gh-1-1');
  assert.equal(run.manifest.sha, '1'.padEnd(40, '0'));
  assert.equal(run.manifest.branch, 'main');
  assert.equal(run.manifest.prNumber, 7);
  assert.equal(run.manifest.ciUrl, 'https://github.com/o/r/actions/runs/1');
  assert.equal(run.reports.length, 1);
  assert.ok(decodeURIComponent(calls[0]).includes('created=>=2026-09-01'), `runs listed since the window start: ${calls[0]}`);
});

test('a run without a matching artifact is skipped and reported; expired and not-completed runs too', async () => {
  const dataDir = tmp();
  const { fetch } = fakeActions({
    runs: [RUN(1), RUN(2), RUN(3, { status: 'in_progress' })],
    artifacts: { 1: [{ id: 1, name: 'playwright-report', expired: false }], 2: [{ id: 2, name: 'razo-test-results-2-1', expired: true }] },
    zips: {},
  });
  const summary = await pullGithubArtifacts({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', dataDir, since: new Date(0) });
  assert.deepEqual(summary.pulled, []);
  assert.deepEqual(summary.skipped, [
    { runId: 'gh-1-1', reason: 'no artifact' }, { runId: 'gh-2-1', reason: 'expired' }, { runId: 'gh-3-1', reason: 'not completed' },
  ]);
  assert.deepEqual(readRuns(dataDir), []);
});

test('pull is incremental: an existing run directory is neither listed for artifacts nor downloaded', async () => {
  const dataDir = tmp();
  const zips = { 501: zipOf({ 'checkout-pays/razo-steps.json': report('pays', 'passed') }) };
  const { fetch, calls } = fakeActions({ runs: [RUN(1)], artifacts: { 1: [{ id: 501, name: 'razo-test-results-1-1', expired: false }] }, zips });
  const api = new GitHubApi({ token: 't', fetch });
  await pullGithubArtifacts({ api, repo: 'o/r', dataDir, since: new Date(0) });
  const downloads = () => calls.filter((u) => /\/zip$/.test(u)).length;
  const listings = () => calls.filter((u) => /\/runs\/\d+\/artifacts/.test(u)).length;
  assert.equal(downloads(), 1);
  const again = await pullGithubArtifacts({ api, repo: 'o/r', dataDir, since: new Date(0) });
  assert.deepEqual(again, { pulled: [], skipped: [{ runId: 'gh-1-1', reason: 'exists' }] });
  assert.equal(downloads(), 1);
  assert.equal(listings(), 1);
});

test('branch and workflow narrow the listing', async () => {
  const dataDir = tmp();
  const { fetch, calls } = fakeActions({ runs: [RUN(1), RUN(2, { head_branch: 'feat/x' })], artifacts: {}, zips: {} });
  await pullGithubArtifacts({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', dataDir, since: new Date(0), branch: 'main', workflow: 'e2e.yml' });
  assert.ok(calls[0].includes('/actions/workflows/e2e.yml/runs'));
  assert.ok(calls[0].includes('branch=main'));
});
