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
  const { suspects } = await findSuspects({ controls, commits, changedFiles: (sha) => code.changedFiles(sha) });
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
  const { suspects } = await findSuspects({
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
  const { suspects } = await findSuspects({ controls, commits, changedFiles: async (sha) => files[sha] }, 2);
  assert.deepEqual(suspects.map((s) => s.sha[0]), ['b', 'c']);
  const { suspects: all } = await findSuspects({ controls, commits, changedFiles: async (sha) => files[sha] });
  assert.deepEqual(all.map((s) => s.sha[0]), ['b', 'c', 'a']);
});

test('a changed file without a patch never scores; when its name carries the component it is unevaluable evidence', async () => {
  const commits = [{ sha: 'a'.repeat(40), message: 'bin', author: 'x', date: '2026-01-01T00:00:00Z' }];
  const { suspects, unevaluable } = await findSuspects({
    controls: [{ controlType: 'image', name: 'Logo', selector: '[data-testid="logo"]' }],
    commits, changedFiles: async () => [{ filename: 'logo.png' }],
  });
  assert.deepEqual(suspects, []);
  assert.deepEqual(unevaluable, [{ sha: 'a'.repeat(40), filename: 'logo.png', components: ['image "Logo"'], reason: 'no patch' }]);
});

test('no controls or no commits means no suspects and no changedFiles calls', async () => {
  let calls = 0;
  const changedFiles = async () => { calls++; return [{ filename: 'x', patch: '+ Save' }]; };
  const commit = { sha: 'a'.repeat(40), message: 'a', author: 'x', date: '2026-01-01T00:00:00Z' };
  const empty = { suspects: [], unevaluable: [] };
  assert.deepEqual(await findSuspects({ controls: [], commits: [commit], changedFiles }), empty);
  assert.deepEqual(await findSuspects({ controls: [{ controlType: 'button', name: 'Save', selector: 'x' }], commits: [], changedFiles }), empty);
  assert.equal(calls, 0);
});

test('commitsInRange is empty without both shas', async () => {
  const code = new MemoryCodeContext(structuredClone(seed.commits));
  assert.deepEqual(await commitsInRange(code, { firstRedSha: seed.commits[2].sha }), []);
  assert.deepEqual(await commitsInRange(code, { lastGreenSha: seed.commits[0].sha }), []);
  assert.equal((await commitsInRange(code, { lastGreenSha: seed.commits[0].sha, firstRedSha: seed.commits[2].sha })).length, 2);
});

// --- unevaluable files and generic needles ---
const commit = (letter, day = '01') => ({ sha: letter.repeat(40), message: `commit ${letter}`, author: 'x', date: `2026-01-${day}T00:00:00Z` });
const placeOrder = { controlType: 'button', name: 'Place order', selector: '[data-testid="place-order"]' };

test('a file without a patch whose name matches a component is unevaluable evidence, not a scored suspect', async () => {
  const result = await findSuspects({
    controls: [placeOrder], commits: [commit('a')],
    changedFiles: async () => [{ filename: 'src/checkout/PlaceOrder.tsx' }],
  });
  assert.deepEqual(result.suspects, []);
  assert.deepEqual(result.unevaluable, [{ sha: 'a'.repeat(40), filename: 'src/checkout/PlaceOrder.tsx', components: ['button "Place order"'], reason: 'no patch' }]);
});

test('a removed file that matches a component is unevaluable even when it has a patch', async () => {
  const result = await findSuspects({
    controls: [placeOrder], commits: [commit('a')],
    changedFiles: async () => [{ filename: 'src/checkout/place-order.tsx', status: 'removed', patch: '- <button>Place order</button>' }],
  });
  assert.deepEqual(result.suspects, []);
  assert.equal(result.unevaluable[0].reason, 'removed');
});

test('a file without a patch that matches nothing is simply skipped', async () => {
  const result = await findSuspects({
    controls: [placeOrder], commits: [commit('a')],
    changedFiles: async () => [{ filename: 'assets/logo.png' }],
  });
  assert.deepEqual(result, { suspects: [], unevaluable: [] });
});

test('a generic needle like "btn" never turns unrelated commits into suspects', async () => {
  const generic = { controlType: 'button', name: 'Pay', selector: 'css=.btn' };
  assert.deepEqual(needlesFor(generic), []);
  const result = await findSuspects({
    controls: [generic], commits: [commit('a'), commit('b', '02')],
    changedFiles: async () => [{ filename: 'src/Nav.tsx', patch: '+ <a class="btn">Home</a>' }],
  });
  assert.deepEqual(result.suspects, []);
});

test('needles match on token boundaries, so "order" does not match "reorder"', async () => {
  const control = { controlType: 'link', name: 'Order', selector: '[data-testid="order"]' };
  assert.deepEqual(needlesFor(control), ['Order', 'order']);
  const result = await findSuspects({
    controls: [control], commits: [commit('a')],
    changedFiles: async () => [{ filename: 'x.ts', patch: '+ reorderItems()\n+ const preorder = 1' }],
  });
  assert.deepEqual(result.suspects, []);
});
