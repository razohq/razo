import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeContextContract,
  issueTrackerContract,
  notifierContract,
  pluginContract,
  resultSourceContract,
  runContract,
  seed,
} from '../dist/contract.js';
import {
  MemoryCodeContext,
  MemoryIssueTracker,
  MemoryNotifier,
  MemoryResultSource,
  memoryCodePlugin,
  memoryNotifierPlugin,
  memorySourcePlugin,
  memoryTrackerPlugin,
} from '../dist/fakes.js';

describe('MemoryResultSource passes the ResultSource contract', () => {
  runContract(resultSourceContract((runs) => new MemoryResultSource(runs)), test);
});

describe('the ResultSource kit catches a source that ignores `since`', () => {
  test('the window case fails', async () => {
    const broken = (runs) => ({ fetchRuns: async () => structuredClone(runs) });
    const cases = resultSourceContract(broken);
    const windowed = cases.find((c) => /at or after/.test(c.name));
    assert.ok(windowed, 'the kit has a case about `since`');
    await assert.rejects(windowed.run());
  });
});

describe('the seed', () => {
  test('ships runs across two commits so window and history cases are meaningful', () => {
    assert.ok(seed.runs.length >= 3);
    assert.ok(new Set(seed.runs.map((r) => r.sha)).size >= 2);
  });
});

describe('MemoryCodeContext passes the CodeContext contract', () => {
  runContract(codeContextContract((commits) => new MemoryCodeContext(commits)), test);
});

describe('the CodeContext kit catches a context that includes `fromSha` in the range', () => {
  test('the range case fails', async () => {
    const broken = (commits) => ({
      commitsBetween: async (from, to) => {
        const i = commits.findIndex((c) => c.sha === from);
        const j = commits.findIndex((c) => c.sha === to);
        return commits.slice(i, j + 1);
      },
      changedFiles: async (sha) => commits.find((c) => c.sha === sha).files,
    });
    const range = codeContextContract(broken).find((c) => /excludes/.test(c.name));
    assert.ok(range);
    await assert.rejects(range.run());
  });
});

describe('MemoryIssueTracker passes the IssueTracker contract', () => {
  runContract(
    issueTrackerContract((issues) => {
      const tracker = new MemoryIssueTracker('memory', issues);
      return { tracker, name: 'memory' };
    }),
    test,
  );
});

describe('the IssueTracker kit catches a tracker whose lookup is a substring match', () => {
  test('the exact-match case fails', async () => {
    const broken = (issues) => ({
      name: 'sloppy',
      tracker: {
        findBySignature: async (sig) => issues.filter((i) => i.signature.includes(sig)).map((i) => i.ref),
        create: async (draft) => ({ tracker: 'sloppy', key: 'X-1', url: 'https://x/1', status: 'open' }),
        comment: async () => {},
      },
    });
    const exact = issueTrackerContract(broken).find((c) => /exact/.test(c.name));
    assert.ok(exact);
    await assert.rejects(exact.run());
  });
});

describe('MemoryNotifier passes the Notifier contract', () => {
  runContract(
    notifierContract(() => {
      const notifier = new MemoryNotifier();
      return { notifier, received: () => notifier.sent };
    }),
    test,
  );
});

describe('the Notifier kit catches a notifier that drops repeated reports', () => {
  test('the repeat case fails', async () => {
    const broken = () => {
      const sent = [];
      const seen = new Set();
      return {
        notifier: { send: async (r) => { if (!seen.has(r.generatedAt)) { seen.add(r.generatedAt); sent.push(r); } } },
        received: () => sent,
      };
    };
    const repeat = notifierContract(broken).find((c) => /twice/.test(c.name));
    assert.ok(repeat);
    await assert.rejects(repeat.run());
  });
});

describe('the memory plugins pass the plugin contract', () => {
  runContract(pluginContract(memorySourcePlugin, { runs: seed.runs }), test);
  runContract(pluginContract(memoryCodePlugin, { commits: seed.commits }), test);
  runContract(pluginContract(memoryTrackerPlugin, { issues: seed.issues }), test);
  runContract(pluginContract(memoryNotifierPlugin, {}), test);
});

describe('memory plugins build adapters that pass their kind\'s contract', () => {
  runContract(resultSourceContract((runs) => memorySourcePlugin.create({ runs })), test);
  runContract(codeContextContract((commits) => memoryCodePlugin.create({ commits })), test);
  runContract(
    issueTrackerContract((issues) => ({ tracker: memoryTrackerPlugin.create({ issues }), name: memoryTrackerPlugin.name })),
    test,
  );
});

describe('the plugin kit catches bad plugins', () => {
  test('a name that is not kebab-case fails the name case', async () => {
    const bad = { ...memoryNotifierPlugin, name: 'Memory Notifier' };
    const nameCase = pluginContract(bad, {}).find((c) => /kebab/.test(c.name));
    assert.ok(nameCase);
    await assert.rejects(nameCase.run());
  });
  test('a schema that accepts anything fails the rejection case', async () => {
    const lax = { ...memoryNotifierPlugin, configSchema: { parse: (x) => x } };
    const rejectCase = pluginContract(lax, {}).find((c) => /reject/.test(c.name));
    assert.ok(rejectCase);
    await assert.rejects(rejectCase.run());
  });
  test('an adapter missing its kind\'s methods fails the shape case', async () => {
    const hollow = { ...memorySourcePlugin, create: () => ({}) };
    const shape = pluginContract(hollow, { runs: seed.runs }).find((c) => /methods/.test(c.name));
    assert.ok(shape);
    await assert.rejects(shape.run());
  });
});
