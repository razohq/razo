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
      if (!zip) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ message: 'Not Found' }), arrayBuffer: async () => new ArrayBuffer(0) };
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

test('review 2b-5: one bad run is skipped with its error and the others still pull', async () => {
  const dataDir = tmp();
  const good = zipOf({ 'checkout-pays/razo-steps.json': report('pays', 'passed') });
  const bad = zipOf({ 'checkout-pays/razo-steps.json': '{"test": "pays", "fi' });
  const { fetch } = fakeActions({
    runs: [RUN(1), RUN(2), RUN(3, { head_branch: null }), RUN(4)],
    artifacts: {
      1: [{ id: 501, name: 'razo-test-results-1-1', expired: false }],
      2: [{ id: 502, name: 'razo-test-results-2-1', expired: false }],
      3: [{ id: 503, name: 'razo-test-results-3-1', expired: false }],
      4: [{ id: 504, name: 'razo-test-results-4-1', expired: false }],
    },
    zips: { 501: bad, 503: good, 504: good },
  });
  const summary = await pullGithubArtifacts({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', dataDir, since: new Date(0) });
  assert.deepEqual(summary.pulled, ['gh-4-1']);
  assert.deepEqual(summary.skipped.map((s) => [s.runId, s.reason]), [['gh-1-1', 'error'], ['gh-2-1', 'error'], ['gh-3-1', 'error']]);
  assert.match(summary.skipped[0].detail, /JSON|razo-steps/);
  assert.match(summary.skipped[1].detail, /404|zip/);
  assert.match(summary.skipped[2].detail, /head_branch/);
  assert.deepEqual(readRuns(dataDir).map((r) => r.manifest.id), ['gh-4-1']);
});

test('review 2b-6: entries that are not reports, or reports over the size cap, are never inflated', () => {
  const big = 'x'.repeat(50_000);
  const zip = zipOf({
    'checkout-pays/razo-steps.json': report('pays', 'passed'),
    'checkout-pays/trace.zip': big,
    'checkout-huge/razo-steps.json': { ...report('huge', 'passed'), padding: big },
  });
  const found = reportsFromZip(zip, { maxEntryBytes: 10_000 });
  assert.deepEqual(found.map((f) => f.report.test), ['pays']);
});

// --- Phase 3 hardening ---
test('hardening: candidates with a different attempt number are never merged; the run is skipped with a warning', async () => {
  const dataDir = tmp();
  const { fetch, calls } = fakeActions({
    runs: [RUN(9, { run_attempt: 2 })],
    artifacts: { 9: [{ id: 901, name: 'razo-test-results-9-1', expired: false }, { id: 903, name: 'razo-test-results-9-3', expired: false }] },
    zips: { 901: zipOf({ 'a/razo-steps.json': report('a', 'passed') }), 903: zipOf({ 'a/razo-steps.json': report('a', 'passed') }) },
  });
  const summary = await pullGithubArtifacts({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', dataDir, since: new Date(0) });
  assert.deepEqual(summary.pulled, []);
  assert.equal(summary.skipped.length, 1);
  assert.equal(summary.skipped[0].reason, 'attempt mismatch');
  assert.match(summary.skipped[0].detail, /run_attempt 2/);
  assert.match(summary.skipped[0].detail, /razo-test-results-9-1.*razo-test-results-9-3/);
  assert.equal(calls.filter((u) => /\/zip$/.test(u)).length, 0, 'nothing downloaded');
  assert.deepEqual(readRuns(dataDir), []);
});

test('hardening: candidates without attempt information are merged as shards', async () => {
  const dataDir = tmp();
  const { fetch } = fakeActions({
    runs: [RUN(6)],
    artifacts: { 6: [{ id: 601, name: 'razo-test-results-nightly-a', expired: false }, { id: 602, name: 'razo-test-results-nightly-b', expired: false }] },
    zips: { 601: zipOf({ 'a-one/razo-steps.json': report('one', 'passed') }), 602: zipOf({ 'b-two/razo-steps.json': report('two', 'passed') }) },
  });
  const summary = await pullGithubArtifacts({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', dataDir, since: new Date(0) });
  assert.deepEqual(summary.pulled, ['gh-6-1']);
  assert.deepEqual(readRuns(dataDir)[0].reports.map((r) => r.report.test).sort(), ['one', 'two']);
});

test('hardening: the exact <prefix><run_id>-<run_attempt> artifact wins; shards of that attempt are merged', async () => {
  const dataDir = tmp();
  const zips = {
    701: zipOf({ 'checkout-pays/razo-steps.json': report('pays', 'passed') }),
    702: zipOf({ 'checkout-pays/razo-steps.json': report('pays', 'failed', { error: 'from attempt 2' }) }),
    801: zipOf({ 'a-one/razo-steps.json': report('one', 'passed') }),
    802: zipOf({ 'b-two/razo-steps.json': report('two', 'passed') }),
  };
  const { fetch } = fakeActions({
    runs: [RUN(7, { run_attempt: 2 }), RUN(8)],
    artifacts: {
      7: [{ id: 701, name: 'razo-test-results-7-1', expired: false }, { id: 702, name: 'razo-test-results-7-2', expired: false }],
      8: [{ id: 801, name: 'razo-test-results-8-1-shard1', expired: false }, { id: 802, name: 'razo-test-results-8-1-shard2', expired: false }],
    },
    zips,
  });
  const summary = await pullGithubArtifacts({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', dataDir, since: new Date(0) });
  assert.deepEqual(summary.pulled, ['gh-7-2', 'gh-8-1']);
  const runs = Object.fromEntries(readRuns(dataDir).map((r) => [r.manifest.id, r]));
  assert.equal(runs['gh-7-2'].reports.length, 1);
  assert.equal(runs['gh-7-2'].reports[0].report.error, 'from attempt 2', 'attempt 2 took its own artifact, not attempt 1');
  assert.deepEqual(runs['gh-8-1'].reports.map((r) => r.report.test).sort(), ['one', 'two'], 'shards merged');
});

test('hardening: an artifact whose zip has no razo report is skipped as no artifact', async () => {
  const dataDir = tmp();
  const { fetch } = fakeActions({
    runs: [RUN(1)],
    artifacts: { 1: [{ id: 501, name: 'razo-test-results-1-1', expired: false }] },
    zips: { 501: zipOf({ 'checkout-pays/error-context.md': '# only context', 'trace.zip': 'x' }) },
  });
  const summary = await pullGithubArtifacts({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', dataDir, since: new Date(0) });
  assert.deepEqual(summary, { pulled: [], skipped: [{ runId: 'gh-1-1', reason: 'no artifact' }] });
  assert.deepEqual(readRuns(dataDir), []);
});
