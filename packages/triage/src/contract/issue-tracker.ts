import assert from 'assert/strict';
import type { IssueDraft } from '../core/model';
import type { IssueTracker } from '../ports/issue-tracker';
import type { ContractCase } from './case';
import { seed, type Seed } from './seed';

export interface IssueTrackerUnderTest {
  tracker: IssueTracker;
  /** The plugin name; every IssueRef the tracker returns must carry it. */
  name: string;
}

/** Builds a tracker that already holds exactly `issues`. */
export type IssueTrackerFactory = (
  issues: Seed['issues'],
) => IssueTrackerUnderTest | Promise<IssueTrackerUnderTest>;

const DRAFT: IssueDraft = {
  title: 'Cart totals drift after discount',
  body: 'Seen in run-3.',
  signature: 'expected "…" to equal "…"',
  labels: ['triage', 'regression'],
};

export function issueTrackerContract(factory: IssueTrackerFactory): ContractCase[] {
  const issues = seed.issues;
  const known = issues[0];
  const fresh = () => factory(structuredClone(issues));

  return [
    {
      name: 'findBySignature returns the seeded issue for its signature',
      async run() {
        const { tracker, name } = await fresh();
        const got = await tracker.findBySignature(known.signature);
        assert.equal(got.length, 1);
        assert.equal(got[0].key, known.ref.key);
        assert.equal(got[0].url, known.ref.url);
        assert.equal(got[0].tracker, name);
      },
    },
    {
      name: 'findBySignature is an exact match, never a substring one',
      async run() {
        const { tracker } = await fresh();
        assert.deepEqual(await tracker.findBySignature(known.signature.slice(0, 10)), []);
        assert.deepEqual(await tracker.findBySignature(`${known.signature} extra`), []);
      },
    },
    {
      name: 'findBySignature of an unknown signature is empty',
      async run() {
        const { tracker } = await fresh();
        assert.deepEqual(await tracker.findBySignature('nobody has ever seen this'), []);
      },
    },
    {
      name: 'create returns a ref carrying the tracker name, a key and a url',
      async run() {
        const { tracker, name } = await fresh();
        const ref = await tracker.create(structuredClone(DRAFT));
        assert.equal(ref.tracker, name);
        assert.ok(ref.key.length > 0, 'key');
        assert.ok(ref.url.length > 0, 'url');
        assert.ok(ref.status.length > 0, 'status');
      },
    },
    {
      name: 'a created issue is findable by its draft signature right away',
      async run() {
        const { tracker } = await fresh();
        const ref = await tracker.create(structuredClone(DRAFT));
        const found = await tracker.findBySignature(DRAFT.signature);
        assert.ok(found.some((i) => i.key === ref.key), 'created issue not found by signature');
      },
    },
    {
      name: 'comment on a known issue resolves',
      async run() {
        const { tracker } = await fresh();
        const [ref] = await tracker.findBySignature(known.signature);
        await tracker.comment(ref, 'Seen again in run-3.');
      },
    },
    {
      name: 'comment on an unknown issue rejects',
      async run() {
        const { tracker, name } = await fresh();
        await assert.rejects(
          tracker.comment({ tracker: name, key: 'NOPE-0', url: 'https://tracker.example/NOPE-0', status: 'open' }, 'hi'),
        );
      },
    },
  ];
}
