import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubApi, GitHubCodeContext, githubCodePlugin } from '../dist/index.js';
import { codeContextContract, pluginContract, runContract, seed } from '../dist/contract.js';

/** A fake GitHub serving compare and commits endpoints from a linear commit list. */
export function fakeGitHub(commits) {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });
  const notFound = () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({ message: 'Not Found' }), arrayBuffer: async () => new ArrayBuffer(0) });
  return async (url) => {
    const u = new URL(url);
    const compare = u.pathname.match(/^\/repos\/o\/r\/compare\/([^.]+)\.\.\.(.+)$/);
    if (compare) {
      const [, from, to] = compare;
      const i = commits.findIndex((c) => c.sha === from);
      const j = commits.findIndex((c) => c.sha === to);
      if (i === -1 || j === -1) return notFound();
      const all = commits.slice(i + 1, j + 1);
      const perPage = Number(u.searchParams.get('per_page') ?? 250);
      const page = Number(u.searchParams.get('page') ?? 1);
      const slice = all.slice((page - 1) * perPage, page * perPage);
      return ok({ total_commits: all.length, commits: slice.map((c) => ({ sha: c.sha, html_url: c.url, commit: { message: `${c.message}\n\nlong body`, author: { name: c.author, date: c.date } } })) });
    }
    const commit = u.pathname.match(/^\/repos\/o\/r\/commits\/(.+)$/);
    if (commit) {
      const c = bySha.get(commit[1]);
      if (!c) return notFound();
      // Status only when the seed carries one, so the kit's deepEqual against the seed holds.
      return ok({ sha: c.sha, files: c.files.map((f) => ({ filename: f.filename, ...(f.status ? { status: f.status } : {}), ...(f.patch ? { patch: f.patch } : {}) })) });
    }
    return notFound();
  };
}

const contextFor = (commits) => new GitHubCodeContext(new GitHubApi({ token: 't', fetch: fakeGitHub(commits) }), 'o/r');

describe('GitHubCodeContext passes the CodeContext contract against a fake GitHub', () => {
  runContract(codeContextContract((commits) => contextFor(commits)), test);
});

test('commitsBetween paginates and keeps the order', async () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ sha: String(i).repeat(40), message: `c${i}`, author: 'x', date: `2026-01-0${i + 1}T00:00:00Z`, files: [] }));
  const urls = [];
  const fetch = fakeGitHub(many);
  const api = new GitHubApi({ token: 't', fetch: async (url, init) => { urls.push(url); return fetch(url, init); } });
  const got = await new GitHubCodeContext(api, 'o/r', { perPage: 4 }).commitsBetween(many[0].sha, many[6].sha);
  assert.deepEqual(got.map((c) => c.message), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  assert.equal(urls.length, 2, 'a full page of four, then a short page of two');
});

test('messages keep only the first line and files keep status and patch', async () => {
  const commits = structuredClone(seed.commits);
  commits[1].files = [
    { filename: 'src/PlaceOrder.tsx', status: 'modified', patch: '+ hidden' },
    { filename: 'assets/logo.png', status: 'removed' },
  ];
  const ctx = contextFor(commits);
  const [mid] = await ctx.commitsBetween(commits[0].sha, commits[1].sha);
  assert.equal(mid.message, commits[1].message, 'the long body is dropped');
  assert.equal(mid.url, commits[1].url);
  assert.deepEqual(await ctx.changedFiles(commits[1].sha), commits[1].files);
});

describe('githubCodePlugin', () => {
  runContract(pluginContract(githubCodePlugin, { repo: 'o/r', token: 't' }), test);
  test('rejects a repo without owner/name shape or an empty token', () => {
    assert.throws(() => githubCodePlugin.configSchema.parse({ repo: 'nope', token: 't' }));
    assert.throws(() => githubCodePlugin.configSchema.parse({ repo: 'o/r', token: '' }));
  });
});

test('review 2b-4: compare pages are capped at 100 and the walk continues until total_commits is reached', async () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ sha: String(i).repeat(40), message: `c${i}`, author: 'x', date: `2026-01-0${i + 1}T00:00:00Z`, files: [] }));
  const urls = [];
  // A server that serves at most 2 commits per page whatever per_page asks, like GitHub's 100 cap.
  const capped = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.includes('/compare/')) u.searchParams.set('per_page', String(Math.min(Number(u.searchParams.get('per_page') ?? 2), 2)));
    urls.push(url);
    return fakeGitHub(many)(u.toString(), init);
  };
  const got = await new GitHubCodeContext(new GitHubApi({ token: 't', fetch: capped }), 'o/r', { perPage: 250 }).commitsBetween(many[0].sha, many[5].sha);
  assert.deepEqual(got.map((c) => c.message), ['c1', 'c2', 'c3', 'c4', 'c5']);
  assert.ok(urls.every((u) => Number(new URL(u).searchParams.get('per_page')) <= 100), 'never asks for more than 100');
});
