import assert from 'assert/strict';
import type { TriageReport } from '../core/model';
import type { Notifier } from '../ports/notifier';
import type { ContractCase } from './case';
import { seed } from './seed';

export interface NotifierUnderTest {
  notifier: Notifier;
  /** What the notifier delivered so far, in order. A real adapter reads it back from a fake endpoint. */
  received(): TriageReport[] | Promise<TriageReport[]>;
}

export type NotifierFactory = () => NotifierUnderTest | Promise<NotifierUnderTest>;

export function notifierContract(factory: NotifierFactory): ContractCase[] {
  const report = () => structuredClone(seed.report);

  return [
    {
      name: 'send resolves and the report arrives intact',
      async run() {
        const { notifier, received } = await factory();
        await notifier.send(report());
        assert.deepEqual(await received(), [report()]);
      },
    },
    {
      name: 'sending the same report twice delivers it twice and never throws',
      async run() {
        const { notifier, received } = await factory();
        await notifier.send(report());
        await notifier.send(report());
        assert.equal((await received()).length, 2);
      },
    },
  ];
}
