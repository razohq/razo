import assert from 'assert/strict';
import type { PluginKind, TriagePlugin } from '../ports/plugin';
import type { ContractCase } from './case';

const KINDS: readonly PluginKind[] = ['source', 'code', 'tracker', 'notifier'];

const METHODS: Record<PluginKind, string[]> = {
  source: ['fetchRuns'],
  code: ['commitsBetween', 'changedFiles'],
  tracker: ['findBySignature', 'create', 'comment'],
  notifier: ['send'],
};

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Shape checks for any plugin. The adapter it builds is verified by the
 * kit of its kind, with a factory that calls `plugin.create(...)`.
 */
export function pluginContract(plugin: TriagePlugin<PluginKind, any>, validConfig: unknown): ContractCase[] {
  return [
    {
      name: 'name is kebab-case',
      async run() {
        assert.match(plugin.name, KEBAB);
      },
    },
    {
      name: 'kind is source, code, tracker or notifier',
      async run() {
        assert.ok(KINDS.includes(plugin.kind), `unknown kind: ${plugin.kind}`);
      },
    },
    {
      name: 'configSchema accepts the valid config',
      async run() {
        plugin.configSchema.parse(validConfig);
      },
    },
    {
      name: 'configSchema rejects a config that is not an object',
      async run() {
        for (const garbage of [42, 'nope', null, undefined, []]) {
          assert.throws(() => plugin.configSchema.parse(garbage), `accepted ${JSON.stringify(garbage)}`);
        }
      },
    },
    {
      name: 'create returns an adapter exposing the methods of its kind',
      async run() {
        const adapter = plugin.create(plugin.configSchema.parse(validConfig)) as unknown as Record<string, unknown>;
        for (const method of METHODS[plugin.kind]) {
          assert.equal(typeof adapter[method], 'function', `${plugin.name} lacks ${method}()`);
        }
      },
    },
  ];
}
