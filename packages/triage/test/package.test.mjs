import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('the package is public on npm', () => {
  assert.notEqual(pkg.private, true);
  assert.equal(pkg.publishConfig?.access, 'public');
});

// npm 11 treats a "./"-prefixed bin path as invalid and silently drops the
// binary at publish time: the package would ship without its CLI.
test('bin paths have no "./" prefix, so npm 11 keeps the triage binary', () => {
  assert.deepEqual(Object.keys(pkg.bin), ['triage']);
  for (const [name, file] of Object.entries(pkg.bin)) {
    assert.doesNotMatch(file, /^\.\//, name);
    assert.ok(fs.existsSync(path.join(root, file)), `${name}: ${file} is built`);
  }
});

test('the CLI starts with a node shebang', () => {
  assert.match(fs.readFileSync(path.join(root, pkg.bin.triage), 'utf8'), /^#!\/usr\/bin\/env node/);
});

test('the package ships its license', () => {
  assert.match(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), /MIT License/);
});
