import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubApi, GitHubApiError } from '../dist/index.js';

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  json: async () => body,
  arrayBuffer: async () => (body instanceof Uint8Array ? body.buffer : new TextEncoder().encode(String(body)).buffer),
});

test('getJson sends the bearer token and the API version, and parses JSON', async () => {
  const calls = [];
  const api = new GitHubApi({ token: 'ghp_x', fetch: async (url, init) => { calls.push({ url, init }); return response(200, { ok: 1 }); } });
  assert.deepEqual(await api.getJson('/repos/a/b'), { ok: 1 });
  assert.equal(calls[0].url, 'https://api.github.com/repos/a/b');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ghp_x');
  assert.equal(calls[0].init.headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('a non-2xx response is a GitHubApiError naming status and path', async () => {
  const api = new GitHubApi({ token: 't', fetch: async () => response(404, { message: 'Not Found' }) });
  await assert.rejects(api.getJson('/repos/a/b/commits/zzz'), (e) => e instanceof GitHubApiError && e.status === 404 && /commits\/zzz/.test(e.message) && /Not Found/.test(e.message));
});

test('getAll follows pages until a short page', async () => {
  const pages = { 1: [1, 2], 2: [3, 4], 3: [5] };
  const urls = [];
  const api = new GitHubApi({ token: 't', fetch: async (url) => { urls.push(url); const page = Number(new URL(url).searchParams.get('page')); return response(200, { items: pages[page] }); } });
  assert.deepEqual(await api.getAll('/repos/a/b/things?x=1', (p) => p.items, 2), [1, 2, 3, 4, 5]);
  assert.equal(urls.length, 3);
  assert.match(urls[0], /x=1&per_page=2&page=1$/);
});

test('getBinary returns a Buffer and follows redirects', async () => {
  const api = new GitHubApi({ token: 't', fetch: async (url, init) => { assert.equal(init.redirect, 'follow'); return response(200, new Uint8Array([1, 2, 3])); } });
  const buf = await api.getBinary('/repos/a/b/actions/artifacts/1/zip');
  assert.ok(Buffer.isBuffer(buf));
  assert.deepEqual([...buf], [1, 2, 3]);
});

test('review 2b-3: GitHubApi refuses an empty token', () => {
  assert.throws(() => new GitHubApi({ token: '' }), /token/);
});
