import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseConfig, loadConfig, instantiate, builtinPlugins, DEFAULT_RULES, RazoSource, MarkdownNotifier, CommitsJsonCodeContext } from '../dist/index.js';

const minimal = {
  source: { plugin: 'razo-source', config: { dataDir: './.razo' } },
  code: { plugin: 'commits-json', config: { path: './commits.json' } },
};

test('defaults: baseBranch main, DEFAULT_RULES, no notifiers', () => {
  const cfg = parseConfig(minimal, {});
  assert.equal(cfg.baseBranch, 'main');
  assert.deepEqual(cfg.rules, DEFAULT_RULES);
  assert.deepEqual(cfg.notifiers, []);
  assert.equal(cfg.pull, undefined);
});

test('rules are deep-merged over the defaults and unknown keys are errors', () => {
  const cfg = parseConfig({ ...minimal, rules: { env: { minFiles: 8 } } }, {});
  assert.equal(cfg.rules.env.minFiles, 8);
  assert.equal(cfg.rules.env.windowMinutes, 10);
  assert.deepEqual(cfg.rules.flaky, DEFAULT_RULES.flaky);
  assert.throws(() => parseConfig({ ...minimal, rules: { env: { minfiles: 8 } } }, {}), /rules\.env\.minfiles/);
});

test('${VAR} expands from the environment anywhere in a string', () => {
  const cfg = parseConfig({ ...minimal, pull: { repo: 'o/r', token: 'tok-${GITHUB_TOKEN}-x' } }, { GITHUB_TOKEN: 'abc' });
  assert.equal(cfg.pull.token, 'tok-abc-x');
});

test('an unset environment variable is an error naming it', () => {
  assert.throws(() => parseConfig({ ...minimal, pull: { repo: 'o/r', token: '${NOPE_TOKEN}' } }, {}), /NOPE_TOKEN/);
});

test('missing source or code is an actionable error', () => {
  assert.throws(() => parseConfig({ code: minimal.code }, {}), /source/);
  assert.throws(() => parseConfig({ source: minimal.source }, {}), /code/);
  assert.throws(() => parseConfig({ ...minimal, notifiers: 'markdown' }, {}), /notifiers/);
});

test('loadConfig reads YAML', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'triage-cfg-')), 'triage.config.yaml');
  fs.writeFileSync(file, `
baseBranch: release
source:
  plugin: razo-source
  config: { dataDir: ./.razo }
code:
  plugin: commits-json
  config: { path: ./commits.json }
notifiers:
  - plugin: markdown
    config: { outDir: ./out }
  - plugin: slack
    enabled: false
    config: { webhookUrl: "\${SLACK}" }
`);
  const cfg = loadConfig(file, { SLACK: 'x' });
  assert.equal(cfg.baseBranch, 'release');
  assert.equal(cfg.notifiers.length, 2);
  assert.throws(() => loadConfig('/nope/triage.config.yaml', {}), /\/nope\/triage\.config\.yaml/);
});

test('instantiate builds the adapters through the registry and skips disabled notifiers', () => {
  const cfg = parseConfig({
    ...minimal,
    notifiers: [{ plugin: 'markdown', config: { outDir: './out' } }, { plugin: 'slack', enabled: false, config: {} }],
  }, {});
  const built = instantiate(cfg);
  assert.ok(built.source instanceof RazoSource);
  assert.ok(built.code instanceof CommitsJsonCodeContext);
  assert.equal(built.notifiers.length, 1);
  assert.ok(built.notifiers[0] instanceof MarkdownNotifier);
});

test('an unknown plugin, or one of the wrong kind, is an error naming it', () => {
  assert.throws(() => instantiate(parseConfig({ ...minimal, code: { plugin: 'nope', config: {} } }, {})), /nope/);
  assert.throws(() => instantiate(parseConfig({ ...minimal, code: { plugin: 'markdown', config: { outDir: 'x' } } }, {})), /markdown.*code|code.*markdown/);
});

test('review 2b-2: the README config snippet parses and expands', () => {
  const readme = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../README.md'), 'utf8');
  const yaml = readme.match(/```yaml\n([\s\S]*?)```/)[1];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'triage-readme-')), 'triage.config.yaml');
  fs.writeFileSync(file, yaml);
  const cfg = loadConfig(file, { GITHUB_TOKEN: 'ghp_test' });
  assert.equal(cfg.pull.token, 'ghp_test');
  assert.equal(cfg.pull.repo, 'razohq/razo-demo');
  assert.equal(cfg.code.config.token, 'ghp_test');
});

test('review 2b-3: an empty or malformed pull token or repo is rejected', () => {
  assert.throws(() => parseConfig({ ...minimal, pull: { repo: 'o/r', token: '${GITHUB_TOKEN}' } }, { GITHUB_TOKEN: '' }), /token/);
  assert.throws(() => parseConfig({ ...minimal, pull: { repo: 'nope', token: 't' } }, {}), /repo/);
});

test('hardening: plugins are looked up by kind and name, so two kinds may share a name', () => {
  const githubTracker = {
    name: 'github', kind: 'tracker', configSchema: { parse: (x) => x },
    create: () => ({ findBySignature: async () => [], create: async () => ({ tracker: 'github', key: 'k', url: 'u', status: 'open' }), comment: async () => {} }),
  };
  const cfg = parseConfig({ ...minimal, code: { plugin: 'github', config: { repo: 'o/r', token: 't' } } }, {});
  const built = instantiate(cfg, [githubTracker, ...builtinPlugins]);
  assert.equal(typeof built.code.commitsBetween, 'function', 'the code plugin named github was chosen, not the tracker');
  assert.throws(() => instantiate(parseConfig({ ...minimal, code: { plugin: 'markdown', config: {} } }, {})), /markdown.*notifier.*code|no code plugin named "markdown"/);
});
