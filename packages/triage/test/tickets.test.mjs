import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkIssues } from '../dist/index.js';
import { seed } from '../dist/contract.js';

const cluster = (id, extra = {}) => ({ ...structuredClone(seed.report.items[0].cluster), id, signature: `sig-${id}`, ...extra });
const ref = (key, status) => ({ tracker: 'github', key, url: `https://github.com/o/r/issues/${key.slice(1)}`, status });
const trackerWith = (bySignature) => ({ name: 'github', find: async (signature) => bySignature[signature] ?? [] });

test('an open issue links the cluster and marks it ticketed', async () => {
  const { clusters } = await linkIssues([cluster('a', { state: 'new' }), cluster('b', { state: 'acknowledged' })], ['a', 'b'],
    trackerWith({ 'sig-a': [ref('#1', 'open')], 'sig-b': [ref('#2', 'open')] }));
  assert.deepEqual(clusters.map((c) => [c.state, c.linkedIssue?.key]), [['ticketed', '#1'], ['ticketed', '#2']]);
});

test('an open issue wins over a closed one for the same failure', async () => {
  const { clusters: [c] } = await linkIssues([cluster('a')], ['a'], trackerWith({ 'sig-a': [ref('#1', 'closed'), ref('#2', 'open')] }));
  assert.equal(c.linkedIssue.key, '#2');
});

test('a person\'s ignore or flaky mark stands; the issue is still linked', async () => {
  const { clusters } = await linkIssues([cluster('a', { state: 'ignored' }), cluster('b', { state: 'flaky' })], ['a', 'b'],
    trackerWith({ 'sig-a': [ref('#1', 'open')], 'sig-b': [ref('#2', 'open')] }));
  assert.deepEqual(clusters.map((c) => [c.state, c.linkedIssue?.key]), [['ignored', '#1'], ['flaky', '#2']]);
});

test('only a closed issue: linked, but the failure is not ticketed while it keeps failing', async () => {
  const { clusters } = await linkIssues([cluster('a', { state: 'new' }), cluster('b', { state: 'ticketed', linkedIssue: ref('#2', 'open') })], ['a', 'b'],
    trackerWith({ 'sig-a': [ref('#1', 'closed')], 'sig-b': [ref('#2', 'closed')] }));
  assert.deepEqual(clusters.map((c) => [c.state, c.linkedIssue?.status]), [['new', 'closed'], ['new', 'closed']]);
});

test('an issue that no longer carries the marker unlinks the cluster', async () => {
  const { clusters: [c] } = await linkIssues([cluster('a', { state: 'ticketed', linkedIssue: ref('#1', 'open') })], ['a'], trackerWith({}));
  assert.equal(c.state, 'new');
  assert.equal(c.linkedIssue, undefined);
});

test('a link from another tracker is left alone when this one finds nothing', async () => {
  const other = { tracker: 'jira', key: 'QA-1', url: 'u', status: 'open' };
  const { clusters: [c] } = await linkIssues([cluster('a', { state: 'ticketed', linkedIssue: other })], ['a'], trackerWith({}));
  assert.deepEqual([c.state, c.linkedIssue], ['ticketed', other]);
});

test('clusters outside the window are not looked up', async () => {
  const asked = [];
  const tracker = { name: 'github', find: async (s) => { asked.push(s); return []; } };
  const { clusters } = await linkIssues([cluster('a'), cluster('old', { state: 'resolved' })], ['a'], tracker);
  assert.deepEqual(asked, ['sig-a']);
  assert.equal(clusters[1].state, 'resolved');
});

test('a failed lookup keeps the cluster as it was and is reported, without stopping the others', async () => {
  const tracker = { name: 'github', find: async (s) => { if (s === 'sig-a') throw new Error('GitHub API 502'); return [ref('#2', 'open')]; } };
  const { clusters, failed } = await linkIssues([cluster('a', { state: 'new' }), cluster('b', { state: 'new' })], ['a', 'b'], tracker);
  assert.deepEqual(clusters.map((c) => c.state), ['new', 'ticketed']);
  assert.deepEqual(failed.map((f) => f.clusterId), ['a']);
  assert.match(failed[0].error, /502/);
});
