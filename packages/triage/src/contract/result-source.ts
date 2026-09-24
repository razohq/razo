import assert from 'assert/strict';
import type { TestRun } from '../core/model';
import { errorSignature } from '../core/signature';
import type { ResultSource } from '../ports/result-source';
import type { ContractCase } from './case';
import { seed } from './seed';

/** Builds a source that already contains exactly `runs`. */
export type ResultSourceFactory = (runs: TestRun[]) => ResultSource | Promise<ResultSource>;

const FAILING: ReadonlySet<string> = new Set(['failed', 'timedOut', 'interrupted']);

const before = (iso: string, ms: number) => new Date(new Date(iso).getTime() - ms);
const after = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms);

export function resultSourceContract(factory: ResultSourceFactory): ContractCase[] {
  const runs = seed.runs;
  const earliest = before(runs[0].finishedAt, 60_000);
  const latest = after(runs[runs.length - 1].finishedAt, 60_000);
  const fresh = () => factory(structuredClone(runs));

  return [
    {
      name: 'returns every run when `since` precedes them all, ascending by startedAt',
      async run() {
        const got = await (await fresh()).fetchRuns(earliest);
        assert.deepEqual(got.map((r) => r.id), runs.map((r) => r.id));
        const starts = got.map((r) => r.startedAt);
        assert.deepEqual(starts, [...starts].sort());
      },
    },
    {
      name: 'keeps only runs whose finishedAt is at or after `since`',
      async run() {
        const cutoff = runs[1].finishedAt;
        const got = await (await fresh()).fetchRuns(new Date(cutoff));
        assert.deepEqual(got.map((r) => r.id), runs.slice(1).map((r) => r.id));
      },
    },
    {
      name: 'returns nothing when `since` is after the last run',
      async run() {
        assert.deepEqual(await (await fresh()).fetchRuns(latest), []);
      },
    },
    {
      name: 'answers the same question the same way twice',
      async run() {
        const source = await fresh();
        assert.deepEqual(await source.fetchRuns(earliest), await source.fetchRuns(earliest));
      },
    },
    {
      name: 'every run carries id, sha, branch, source and ISO timestamps',
      async run() {
        for (const run of await (await fresh()).fetchRuns(earliest)) {
          for (const field of ['id', 'sha', 'branch', 'source'] as const) {
            assert.ok(run[field].length > 0, `${run.id}: ${field} is empty`);
          }
          assert.ok(!Number.isNaN(Date.parse(run.startedAt)), `${run.id}: startedAt`);
          assert.ok(!Number.isNaN(Date.parse(run.finishedAt)), `${run.id}: finishedAt`);
        }
      },
    },
    {
      name: 'testId is unique within a run',
      async run() {
        for (const run of await (await fresh()).fetchRuns(earliest)) {
          const ids = run.results.map((r) => r.testId);
          assert.equal(new Set(ids).size, ids.length, `${run.id} repeats a testId`);
        }
      },
    },
    {
      name: 'attempts are never empty and the last one carries the final status',
      async run() {
        for (const run of await (await fresh()).fetchRuns(earliest)) {
          for (const result of run.results) {
            assert.ok(result.attempts.length > 0, `${result.testId}: no attempts`);
            assert.equal(result.attempts[result.attempts.length - 1].status, result.status, result.testId);
          }
        }
      },
    },
    {
      name: 'a failing result has an error and a passing one does not',
      async run() {
        for (const run of await (await fresh()).fetchRuns(earliest)) {
          for (const result of run.results) {
            const failing = FAILING.has(result.status);
            assert.equal(result.error !== undefined, failing, `${result.testId}: error/status mismatch`);
          }
        }
      },
    },
    {
      name: 'error signatures are the core\'s errorSignature of the message',
      async run() {
        for (const run of await (await fresh()).fetchRuns(earliest)) {
          for (const result of run.results) {
            const errors = [result.error, ...result.attempts.map((a) => a.error)];
            for (const error of errors) {
              if (!error) continue;
              assert.equal(error.signature, errorSignature(error.message), result.testId);
            }
          }
        }
      },
    },
  ];
}
