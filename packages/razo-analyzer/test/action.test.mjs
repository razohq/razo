import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// action.yml is published with the package and has no other test: these are the
// things that broke it before (an unscoped npx name, no GITHUB_TOKEN) or that it lacked.
const action = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../action.yml'), 'utf8');

test('the action runs the scoped package: no unscoped razo-analyzer exists on npm', () => {
  assert.match(action, /npx --yes --package @razohq\/razo-analyzer razo-analyze /);
  assert.doesNotMatch(action, /npx --yes razo-analyzer/);
});

test('the action passes the workflow token, which --pr-comment needs', () => {
  assert.match(action, /github-token:[\s\S]*?default: '\$\{\{ github\.token \}\}'/);
  assert.match(action, /GITHUB_TOKEN: \$\{\{ inputs\.github-token \}\}/);
});

test('the action offers both providers, with no key required up front', () => {
  for (const input of ['provider', 'anthropic-api-key', 'openai-api-key', 'model']) {
    assert.match(action, new RegExp(`\\n  ${input}:\\n`), input);
  }
  assert.doesNotMatch(action, /required: true/);
  assert.match(action, /OPENAI_API_KEY: \$\{\{ inputs\.openai-api-key \}\}/);
});

test('inputs reach the script as environment variables, never interpolated into it', () => {
  const run = action.slice(action.indexOf('run: |'));
  assert.doesNotMatch(run, /\$\{\{ inputs\./);
});
