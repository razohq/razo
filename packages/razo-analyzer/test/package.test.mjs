import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'));

// npm 11 treats a "./"-prefixed bin path as invalid and silently drops the
// binary at publish time: the package would ship without its CLIs.
test('bin paths have no "./" prefix, so npm 11 keeps every binary', () => {
  for (const [name, file] of Object.entries(pkg.bin)) {
    assert.doesNotMatch(file, /^\.\//, name);
    assert.ok(fs.existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', file)), `${name}: ${file} is built`);
  }
});
