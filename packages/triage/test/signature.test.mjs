import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorSignature, clusterIdOf } from '../dist/index.js';

test('keeps only the first line, trimmed and lowercased', () => {
  assert.equal(
    errorSignature('  Timeout Exceeded while waiting\n    at foo.ts:12'),
    'timeout exceeded while waiting',
  );
});

test('an empty or missing message becomes "unknown error"', () => {
  assert.equal(errorSignature(''), 'unknown error');
  assert.equal(errorSignature('\n\n'), 'unknown error');
  assert.equal(errorSignature(undefined), 'unknown error');
});

test('quoted values are kept: a different control is a different failure', () => {
  assert.equal(errorSignature('locator "x" not found'), 'locator "x" not found');
});

test('ISO timestamps, UUIDs, long hex ids, long numeric ids and ports are replaced by placeholders', () => {
  assert.equal(errorSignature('started 2026-09-24T07:00:01.123Z'), 'started <ts>');
  assert.equal(
    errorSignature('job 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed'),
    'job <uuid> failed',
  );
  assert.equal(errorSignature('commit deadbeefcafe1234 missing'), 'commit <hex> missing');
  assert.equal(errorSignature('order 12345678 not found'), 'order <id> not found');
  assert.equal(errorSignature('ECONNREFUSED 127.0.0.1:54321'), 'econnrefused 127.0.0.1:<port>');
  assert.equal(errorSignature('GET https://api.example.com:8443/x failed'), 'get https://api.example.com:<port>/x failed');
});

test('short numbers are kept: they are assertion values, not ids', () => {
  assert.equal(errorSignature('expected 3 rows, got 17'), 'expected 3 rows, got 17');
  assert.equal(errorSignature('Timeout 30000ms exceeded'), 'timeout 30000ms exceeded');
});

test('clusterIdOf is a stable 12-char hex hash of the signature', () => {
  const id = clusterIdOf('expected N rows, got N');
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(id, clusterIdOf('expected N rows, got N'));
  assert.notEqual(id, clusterIdOf('expected N rows, got M'));
});

// --- Distinct failures must NOT collapse into one signature ---

test('different assertion numbers stay different', () => {
  assert.notEqual(errorSignature('expected 3 rows, got 17'), errorSignature('expected 5 rows, got 17'));
  assert.notEqual(errorSignature('expected 3 rows, got 17'), errorSignature('expected 3 rows, got 0'));
});

test('selectors that differ only by a short hash stay different', () => {
  assert.notEqual(
    errorSignature('locator ".btn-a1b2c3" not found'),
    errorSignature('locator ".btn-d4e5f6" not found'),
  );
  assert.notEqual(
    errorSignature('locator "[data-testid=save-3f2a]" not found'),
    errorSignature('locator "[data-testid=cancel-9b1c]" not found'),
  );
});

test('messages that differ only in a business value stay different', () => {
  assert.notEqual(
    errorSignature('expected "Exported model.3mf" but got "Exported model.stl"'),
    errorSignature('expected "Exported model.3mf" but got "Export failed"'),
  );
  assert.notEqual(
    errorSignature('locator "button[name=Place order]" not found'),
    errorSignature('locator "button[name=Save]" not found'),
  );
});

test('the same failure with a different id, timestamp or port still collapses', () => {
  assert.equal(
    errorSignature('order 3f2504e0-4f89-11d3-9a0c-0305e82c3301 not found at 2026-09-24T07:00:01Z'),
    errorSignature('order 9b1c0d2e-1111-4222-8333-444455556666 not found at 2026-09-25T08:30:59Z'),
  );
  assert.equal(
    errorSignature('ECONNREFUSED localhost:54321'),
    errorSignature('ECONNREFUSED localhost:60002'),
  );
  assert.equal(errorSignature('order 12345678 not found'), errorSignature('order 87654321 not found'));
});
