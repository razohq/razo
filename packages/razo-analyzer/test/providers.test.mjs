import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFailures, validateProviderOptions } from '../dist/index.js';

const report = {
  test: 'checkout', file: 'demo.spec.ts', status: 'failed', durationMs: 100,
  error: 'boom',
  steps: [{
    action: 'click', controlType: 'button', name: 'Export',
    sentence: 'Click button "Export"', selector: '[data-testid="export"]',
    status: 'failed', error: 'boom', timestamp: '2026-07-18T00:00:00Z',
  }],
};

test('openai provider sends system+user and parses content and usage', async () => {
  const calls = [];
  const fakeOpenAi = {
    chat: {
      completions: {
        create: async (params) => {
          calls.push(params);
          return {
            choices: [{ message: { content: '## verdict' } }],
            usage: { prompt_tokens: 11, completion_tokens: 22 },
          };
        },
      },
    },
  };
  const result = await analyzeFailures([report], {
    provider: 'openai', model: 'some-openai-model', openaiClient: fakeOpenAi,
  });
  assert.equal(result, '## verdict');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'some-openai-model');
  assert.equal(calls[0].messages[0].role, 'system');
  assert.equal(calls[0].messages[1].role, 'user');
  assert.match(calls[0].messages[1].content, /checkout/);
});

test('openai provider batches like anthropic (one call per batch)', async () => {
  let calls = 0;
  const fakeOpenAi = {
    chat: { completions: { create: async () => {
      calls += 1;
      return { choices: [{ message: { content: `part ${calls}` } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    } } },
  };
  const reports = Array.from({ length: 8 }, (_, i) => ({
    ...report,
    test: `t${i}`,
    steps: Array.from({ length: 150 }, (_, j) => ({ ...report.steps[0], name: `s${j}` })),
  }));
  const result = await analyzeFailures(reports, {
    provider: 'openai', model: 'm', openaiClient: fakeOpenAi, budgetChars: 40_000,
  });
  assert.ok(calls > 1);
  assert.match(result, /part 1[\s\S]*part 2/);
});

test('validateProviderOptions enforces model and key for openai', () => {
  assert.equal(validateProviderOptions('anthropic', 'x', {}), null);
  assert.match(validateProviderOptions('openai', undefined, { OPENAI_API_KEY: 'k' }), /--model/);
  assert.match(validateProviderOptions('openai', 'm', {}), /OPENAI_API_KEY/);
  assert.equal(validateProviderOptions('openai', 'm', { OPENAI_API_KEY: 'k' }), null);
  assert.match(validateProviderOptions('gemini', 'm', {}), /Unknown provider/);
});
