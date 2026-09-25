import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CommitsJsonCodeContext, commitsJsonCodePlugin } from '../dist/index.js';
import { codeContextContract, pluginContract, runContract } from '../dist/contract.js';

const write = (commits) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'commits-json-')), 'commits.json');
  fs.writeFileSync(file, JSON.stringify(commits));
  return file;
};

describe('CommitsJsonCodeContext passes the CodeContext contract', () => {
  runContract(codeContextContract((commits) => new CommitsJsonCodeContext(write(commits))), test);
});

describe('commitsJsonCodePlugin', () => {
  runContract(pluginContract(commitsJsonCodePlugin, { path: write([]) }), test);
  test('a missing file is an error naming the path', async () => {
    await assert.rejects(new CommitsJsonCodeContext('/nope/commits.json').changedFiles('x'), /\/nope\/commits\.json/);
  });
});
