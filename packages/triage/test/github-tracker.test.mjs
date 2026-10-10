import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubApi, GitHubIssueTracker, githubTrackerPlugin, clusterIdOf, issueMarker } from '../dist/index.js';
import { issueTrackerContract, pluginContract, runContract, seed } from '../dist/contract.js';
import { fakeIssues } from './helpers/fake-github-issues.mjs';

const trackerFor = (fake) => new GitHubIssueTracker(new GitHubApi({ token: 't', fetch: fake.fetch }), 'o/r');

describe('GitHubIssueTracker passes the IssueTracker contract against a fake GitHub', () => {
  runContract(issueTrackerContract((issues) => ({ tracker: trackerFor(fakeIssues(issues)), name: 'github' })), test);
});

describe('the github tracker plugin', () => {
  runContract(pluginContract(githubTrackerPlugin, { repo: 'o/r', token: 't' }), test);
});

test('an issue is marked by a line naming the cluster id, so a lookup is exact', async () => {
  const signature = seed.issues[0].signature;
  assert.equal(issueMarker(signature), `razo-triage: ${clusterIdOf(signature)}`);
  const fake = fakeIssues(seed.issues);
  // Another issue whose body merely mentions the id inside a longer token is not a match.
  fake.issues.push({ number: 9, title: 'x', state: 'open', body: `razo-triage: ${clusterIdOf(signature)}0`, html_url: 'https://github.com/o/r/issues/9' });
  const found = await trackerFor(fake).findBySignature(signature);
  assert.deepEqual(found.map((i) => i.key), ['#1']);
  assert.deepEqual(found[0], { tracker: 'github', key: '#1', url: 'https://github.com/o/r/issues/1', status: 'open' });
});

test('lookups search issues of the configured repository only, never pull requests', async () => {
  const fake = fakeIssues(seed.issues);
  await trackerFor(fake).findBySignature(seed.issues[0].signature);
  const [search] = fake.calls;
  assert.match(search.q, /repo:o\/r/);
  assert.match(search.q, /is:issue/);
  assert.match(search.q, new RegExp(`"razo-triage: ${clusterIdOf(seed.issues[0].signature)}"`));
});

test('a closed issue is reported with its status', async () => {
  const fake = fakeIssues([{ ...seed.issues[0], ref: { ...seed.issues[0].ref, status: 'closed' } }]);
  const [found] = await trackerFor(fake).findBySignature(seed.issues[0].signature);
  assert.equal(found.status, 'closed');
});

test('newIssueUrl opens GitHub\'s new-issue form filled with the draft and its marker', () => {
  const tracker = trackerFor(fakeIssues());
  const draft = { title: 'Discount is wrong', body: 'Category: regression', signature: seed.issues[0].signature, labels: ['triage', 'regression'] };
  const url = new URL(tracker.newIssueUrl(draft));
  assert.equal(`${url.origin}${url.pathname}`, 'https://github.com/o/r/issues/new');
  assert.equal(url.searchParams.get('title'), 'Discount is wrong');
  assert.equal(url.searchParams.get('labels'), 'triage,regression');
  assert.match(url.searchParams.get('body'), /^Category: regression\n\nrazo-triage: [0-9a-f]{12}$/);
});

test('newIssueUrl keeps the marker when it shortens a long body to fit a URL', () => {
  const tracker = trackerFor(fakeIssues());
  const draft = { title: 't', body: 'x'.repeat(20_000), signature: 's', labels: [] };
  const url = tracker.newIssueUrl(draft);
  assert.ok(url.length <= 8000, `${url.length} chars`);
  assert.match(new URL(url).searchParams.get('body'), /razo-triage: [0-9a-f]{12}$/);
});

test('a 403 explains the issues permission the token needs', async () => {
  const fetch = async () => ({ ok: false, status: 403, headers: { get: () => null }, json: async () => ({ message: 'Resource not accessible' }), arrayBuffer: async () => new ArrayBuffer(0) });
  const tracker = new GitHubIssueTracker(new GitHubApi({ token: 't', fetch }), 'o/r');
  await assert.rejects(tracker.findBySignature('s'), /issues:read/);
});
