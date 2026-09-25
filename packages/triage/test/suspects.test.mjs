import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needlesFor, changedLines, findSuspects, commitsInRange } from '../dist/index.js';
import { MemoryCodeContext } from '../dist/fakes.js';
import { seed } from '../dist/contract.js';

test('needles are the name and the quoted parts of the selector, 3+ chars only', () => {
  assert.deepEqual(needlesFor({ controlType: 'button', name: 'Place order', selector: '[data-testid="place-order"]' }), ['Place order', 'place-order']);
  assert.deepEqual(needlesFor({ controlType: 'button', name: 'OK', selector: 'role=button[name="OK"]' }), []);
  assert.deepEqual(needlesFor({ controlType: 'link', name: 'Help', selector: "text='Help me'" }), ['Help', 'Help me']);
  assert.deepEqual(needlesFor({ controlType: 'button', name: 'Export', selector: '[data-testid="Export"]' }), ['Export'], 'no duplicate needles');
});

test('changedLines keeps added and removed lines and drops the file headers', () => {
  assert.deepEqual(changedLines('--- a/x\n+++ b/x\n@@\n context\n-old\n+new\n'), ['-old', '+new']);
});

test('a commit scores one per control it names in a changed line', async () => {
  const code = new MemoryCodeContext(structuredClone(seed.commits));
  const controls = [
    { controlType: 'field', name: 'Email', selector: '[data-testid="email"]' },
    { controlType: 'button', name: 'Place order', selector: '[data-testid="place-order"]' },
  ];
  const commits = await code.commitsBetween(seed.commits[0].sha, seed.commits[2].sha);
  const suspects = await findSuspects({ controls, commits, changedFiles: (sha) => code.changedFiles(sha) });
  assert.equal(suspects.length, 1);
  assert.equal(suspects[0].sha, seed.commits[1].sha);
  assert.equal(suspects[0].message, seed.commits[1].message);
  assert.equal(suspects[0].author, seed.commits[1].author);
  assert.deepEqual(suspects[0].overlappingComponents, ['button "Place order"']);
  assert.equal(suspects[0].score, 1);
});

test('commits that touch nothing the test used are not suspects', async () => {
  const code = new MemoryCodeContext(structuredClone(seed.commits));
  const commits = await code.commitsBetween(seed.commits[0].sha, seed.commits[2].sha);
  const suspects = await findSuspects({
    controls: [{ controlType: 'table', name: 'Cart', selector: '[data-testid="cart"]' }],
    commits, changedFiles: (sha) => code.changedFiles(sha),
  });
  assert.deepEqual(suspects, []);
});

test('higher score first, then the most recent; capped at max', async () => {
  const commits = [
    { sha: 'a'.repeat(40), message: 'a', author: 'x', date: '2026-01-01T00:00:00Z' },
    { sha: 'b'.repeat(40), message: 'b', author: 'x', date: '2026-01-02T00:00:00Z' },
    { sha: 'c'.repeat(40), message: 'c', author: 'x', date: '2026-01-03T00:00:00Z' },
    { sha: 'd'.repeat(40), message: 'd', author: 'x', date: '2026-01-04T00:00:00Z' },
  ];
  const files = {
    [commits[0].sha]: [{ filename: 'a.ts', patch: '+ save-button' }],
    [commits[1].sha]: [{ filename: 'b.ts', patch: '+ save-button\n+ cancel-button' }],
    [commits[2].sha]: [{ filename: 'c.ts', patch: '+ save-button' }],
    [commits[3].sha]: [{ filename: 'd.ts', patch: '+ nothing' }],
  };
  const controls = [
    { controlType: 'button', name: 'Save', selector: '[data-testid="save-button"]' },
    { controlType: 'button', name: 'Cancel', selector: '[data-testid="cancel-button"]' },
  ];
  const suspects = await findSuspects({ controls, commits, changedFiles: async (sha) => files[sha] }, 2);
  assert.deepEqual(suspects.map((s) => s.sha[0]), ['b', 'c']);
  const all = await findSuspects({ controls, commits, changedFiles: async (sha) => files[sha] });
  assert.deepEqual(all.map((s) => s.sha[0]), ['b', 'c', 'a']);
});

test('a changed file without a patch never matches', async () => {
  const commits = [{ sha: 'a'.repeat(40), message: 'bin', author: 'x', date: '2026-01-01T00:00:00Z' }];
  const suspects = await findSuspects({
    controls: [{ controlType: 'image', name: 'Logo', selector: '[data-testid="logo"]' }],
    commits, changedFiles: async () => [{ filename: 'logo.png' }],
  });
  assert.deepEqual(suspects, []);
});

test('no controls or no commits means no suspects and no changedFiles calls', async () => {
  let calls = 0;
  const changedFiles = async () => { calls++; return [{ filename: 'x', patch: '+ Save' }]; };
  const commit = { sha: 'a'.repeat(40), message: 'a', author: 'x', date: '2026-01-01T00:00:00Z' };
  assert.deepEqual(await findSuspects({ controls: [], commits: [commit], changedFiles }), []);
  assert.deepEqual(await findSuspects({ controls: [{ controlType: 'button', name: 'Save', selector: 'x' }], commits: [], changedFiles }), []);
  assert.equal(calls, 0);
});

test('commitsInRange is empty without both shas', async () => {
  const code = new MemoryCodeContext(structuredClone(seed.commits));
  assert.deepEqual(await commitsInRange(code, { firstRedSha: seed.commits[2].sha }), []);
  assert.deepEqual(await commitsInRange(code, { lastGreenSha: seed.commits[0].sha }), []);
  assert.equal((await commitsInRange(code, { lastGreenSha: seed.commits[0].sha, firstRedSha: seed.commits[2].sha })).length, 2);
});
