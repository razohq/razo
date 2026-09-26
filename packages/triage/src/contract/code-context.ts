import assert from 'assert/strict';
import type { CodeContext } from '../ports/code-context';
import type { ContractCase } from './case';
import { seed, type Seed } from './seed';

/** Builds a context that knows exactly `commits`, in the given chronological order. */
export type CodeContextFactory = (commits: Seed['commits']) => CodeContext | Promise<CodeContext>;

const UNKNOWN_SHA = '0000000000000000000000000000000000000000';

export function codeContextContract(factory: CodeContextFactory): ContractCase[] {
  const commits = seed.commits;
  const [first, ...rest] = commits;
  const last = commits[commits.length - 1];
  const fresh = () => factory(structuredClone(commits));

  return [
    {
      name: 'commitsBetween excludes fromSha, includes toSha, in chronological order',
      async run() {
        const got = await (await fresh()).commitsBetween(first.sha, last.sha);
        assert.deepEqual(got.map((c) => c.sha), rest.map((c) => c.sha));
      },
    },
    {
      name: 'commitsBetween of a sha with itself is empty',
      async run() {
        assert.deepEqual(await (await fresh()).commitsBetween(last.sha, last.sha), []);
      },
    },
    {
      name: 'commitsBetween rejects an unknown sha instead of answering empty',
      async run() {
        const context = await fresh();
        await assert.rejects(context.commitsBetween(UNKNOWN_SHA, last.sha));
        await assert.rejects(context.commitsBetween(first.sha, UNKNOWN_SHA));
      },
    },
    {
      name: 'every commit carries sha, message, author and an ISO date',
      async run() {
        for (const commit of await (await fresh()).commitsBetween(first.sha, last.sha)) {
          for (const field of ['sha', 'message', 'author'] as const) {
            assert.ok(commit[field].length > 0, `${commit.sha}: ${field} is empty`);
          }
          assert.ok(!Number.isNaN(Date.parse(commit.date)), `${commit.sha}: date`);
        }
      },
    },
    {
      name: 'changedFiles returns the files the commit touched, with their patches',
      async run() {
        const context = await fresh();
        for (const commit of commits) {
          assert.deepEqual(await context.changedFiles(commit.sha), commit.files, commit.sha);
        }
      },
    },
    {
      name: 'changedFiles rejects an unknown sha',
      async run() {
        await assert.rejects((await fresh()).changedFiles(UNKNOWN_SHA));
      },
    },
  ];
}
