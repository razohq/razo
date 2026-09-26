import assert from 'assert/strict';
import type { TriageAction, TriageRunRecord } from '../core/model';
import type { TriageStore } from '../ports/store';
import type { ContractCase } from './case';
import { seed } from './seed';

/** Builds an empty store. Each case gets a fresh one. */
export type StoreFactory = () => TriageStore | Promise<TriageStore>;

const run = (id: string, generatedAt: string): TriageRunRecord => ({
  id, generatedAt, window: { from: '2026-09-25T07:00:00Z', to: generatedAt },
  totals: { tests: 4, failures: 2, clusters: 1 }, durationMs: 1200,
});

const action = (clusterId: string, at: string, kind: TriageAction['action'] = 'acknowledge'): TriageAction => ({
  clusterId, action: kind, user: 'ana', at,
});

export function storeContract(factory: StoreFactory): ContractCase[] {
  const cluster = () => structuredClone(seed.report.items[0].cluster);

  return [
    {
      name: 'an empty store has no clusters, no last triage and no actions',
      async run() {
        const store = await factory();
        assert.deepEqual(await store.loadClusters(), []);
        assert.equal(await store.lastTriageAt(), null);
        assert.deepEqual(await store.actionsFor('nobody'), []);
      },
    },
    {
      name: 'saveClusters then loadClusters returns exactly what was saved',
      async run() {
        const store = await factory();
        const saved = [cluster(), { ...cluster(), id: 'other', signature: 'other', state: 'ignored' as const }];
        await store.saveClusters(structuredClone(saved));
        assert.deepEqual(await store.loadClusters(), saved);
      },
    },
    {
      name: 'saveClusters replaces the previous set rather than appending',
      async run() {
        const store = await factory();
        await store.saveClusters([cluster(), { ...cluster(), id: 'other' }]);
        await store.saveClusters([cluster()]);
        assert.equal((await store.loadClusters()).length, 1);
      },
    },
    {
      name: 'lastTriageAt advances with each recorded run and is the latest generatedAt',
      async run() {
        const store = await factory();
        await store.recordRun(run('r1', '2026-09-25T07:00:00Z'));
        assert.equal((await store.lastTriageAt())?.toISOString(), '2026-09-25T07:00:00.000Z');
        await store.recordRun(run('r2', '2026-09-26T07:00:00Z'));
        assert.equal((await store.lastTriageAt())?.toISOString(), '2026-09-26T07:00:00.000Z');
      },
    },
    {
      name: 'actionsFor returns the actions of that cluster only, in recording order',
      async run() {
        const store = await factory();
        await store.recordAction(action('c1', '2026-09-26T07:01:00Z'));
        await store.recordAction(action('c2', '2026-09-26T07:02:00Z', 'ignore'));
        await store.recordAction(action('c1', '2026-09-26T07:03:00Z', 'mark-flaky'));
        assert.deepEqual((await store.actionsFor('c1')).map((a) => a.action), ['acknowledge', 'mark-flaky']);
        assert.deepEqual((await store.actionsFor('c2')).map((a) => a.action), ['ignore']);
      },
    },
    {
      name: 'what comes back is a copy: mutating it does not change the store',
      async run() {
        const store = await factory();
        await store.saveClusters([cluster()]);
        const [loaded] = await store.loadClusters();
        loaded.state = 'resolved';
        assert.equal((await store.loadClusters())[0].state, cluster().state);
      },
    },
  ];
}
