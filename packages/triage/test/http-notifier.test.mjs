import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpNotifier, httpNotifierPlugin, prepareReportForUpload,
  MAX_CLUSTERS_PER_REPORT, MAX_FAILURES_PER_CLUSTER, MAX_EVIDENCE_PER_VERDICT, MAX_UPLOAD_BYTES,
} from '../dist/index.js';
import { notifierContract, pluginContract, runContract, seed } from '../dist/contract.js';

/** A fake destination (razo-cloud, qano-cloud, anything that speaks the delivery contract): records every report it accepts. */
function fakeCloud({ status = 201, failUntil = 0 } = {}) {
  const received = [];
  const calls = [];
  let n = 0;
  const fetch = async (url, init) => {
    calls.push({ url, init });
    n++;
    if (n <= failUntil) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: 'down' }), text: async () => 'down' };
    if (status >= 400) return { ok: false, status, headers: { get: () => null }, json: async () => ({ error: 'nope' }), text: async () => 'nope' };
    received.push(JSON.parse(init.body));
    return { ok: true, status, headers: { get: () => null }, json: async () => ({ ok: true }), text: async () => '' };
  };
  return { fetch, received, calls };
}

describe('HttpNotifier passes the Notifier contract against a fake destination', () => {
  runContract(notifierContract(() => {
    const cloud = fakeCloud();
    return { notifier: new HttpNotifier({ url: 'https://razo.ar/api/triage/reports', token: 'rz_test' }, cloud.fetch), received: () => cloud.received };
  }), test);
});

describe('httpNotifierPlugin', () => {
  runContract(pluginContract(httpNotifierPlugin, { url: 'https://razo.ar/api/triage/reports', token: 'rz_test' }), test);
  test('rejects a missing url, a non-http url, or an empty token', () => {
    assert.throws(() => httpNotifierPlugin.configSchema.parse({ token: 'rz_x' }), /url/);
    assert.throws(() => httpNotifierPlugin.configSchema.parse({ url: 'ftp://razo.ar', token: 'rz_x' }), /url/);
    assert.throws(() => httpNotifierPlugin.configSchema.parse({ url: 'https://razo.ar', token: '' }), /token/);
  });
  test('the destination is whatever the url says: razo-cloud, qano-cloud or any other implementer of the contract', async () => {
    const cloud = fakeCloud();
    await new HttpNotifier({ url: 'https://qano.cloud/hooks/triage', token: 'qn_1' }, cloud.fetch).send(seed.report);
    assert.equal(cloud.calls[0].url, 'https://qano.cloud/hooks/triage');
    assert.equal(cloud.calls[0].init.headers.Authorization, 'Bearer qn_1');
  });
});

test('send posts the report as JSON to the configured endpoint with the bearer token', async () => {
  const cloud = fakeCloud();
  await new HttpNotifier({ url: 'https://razo.ar/api/triage/reports', token: 'rz_abc' }, cloud.fetch).send(seed.report);
  const [{ url, init }] = cloud.calls;
  assert.equal(url, 'https://razo.ar/api/triage/reports');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer rz_abc');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), seed.report);
});

test('a non-2xx answer is an error naming the status and the body', async () => {
  const cloud = fakeCloud({ status: 401 });
  await assert.rejects(new HttpNotifier({ url: 'https://razo.ar/api/triage/reports', token: 'rz_abc' }, cloud.fetch).send(seed.report), /401.*nope/);
});

const bigItem = (i, failures, evidence) => {
  const item = seed.report.items[0];
  return {
    ...item,
    cluster: { ...item.cluster, id: `c${i}`, failures: Array.from({ length: failures }, (_, k) => ({ runId: `r${k}`, testId: 't', sha: 'x' })) },
    verdict: { ...item.verdict, clusterId: `c${i}`, evidence: Array.from({ length: evidence }, (_, k) => ({ kind: 'history', description: `e${k}` })), summary: 'y'.repeat(5000) },
  };
};

test('prepareReportForUpload trims below the delivery caps, keeping the most recent failures and the first evidence', () => {
  const items = [bigItem(0, MAX_FAILURES_PER_CLUSTER + 10, MAX_EVIDENCE_PER_VERDICT + 5), bigItem(1, 3, 2)];
  const { report, trimmed } = prepareReportForUpload({ ...seed.report, items });
  assert.equal(trimmed, true);
  assert.equal(report.items.length, 2);
  assert.equal(report.items[0].cluster.failures.length, MAX_FAILURES_PER_CLUSTER);
  assert.equal(report.items[0].cluster.failures[0].runId, 'r10', 'the oldest failures are dropped');
  assert.equal(report.items[0].verdict.evidence.length, MAX_EVIDENCE_PER_VERDICT);
  assert.equal(report.items[0].verdict.evidence[0].description, 'e0');
  assert.ok(report.items[0].verdict.summary.length < 5000);
  assert.equal(report.items[1].cluster.failures.length, 3, 'a small cluster is untouched');
  const untouched = prepareReportForUpload(seed.report);
  assert.equal(untouched.trimmed, false);
  assert.deepEqual(untouched.report, seed.report);
});

test('prepareReportForUpload fits the byte budget by shrinking the heaviest clusters first, then dropping the last ones', () => {
  const items = Array.from({ length: MAX_CLUSTERS_PER_REPORT + 3 }, (_, i) => bigItem(i, MAX_FAILURES_PER_CLUSTER + 10, 5));
  const { report, trimmed } = prepareReportForUpload({ ...seed.report, items });
  assert.equal(trimmed, true);
  assert.ok(report.items.length <= MAX_CLUSTERS_PER_REPORT);
  assert.ok(report.items.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= MAX_UPLOAD_BYTES);
  assert.equal(report.items[0].cluster.id, 'c0', 'the first clusters, the ones the report ranks highest, survive');
  const last = report.items[0].cluster.failures;
  assert.equal(last[last.length - 1].runId, `r${MAX_FAILURES_PER_CLUSTER + 9}`, 'shrinking keeps the most recent failures');
});
