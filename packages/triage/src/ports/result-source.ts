import type { TestRun } from '../core/model';

/**
 * Where test runs come from. Contract (see contract/result-source.ts):
 * returns runs whose `finishedAt` is at or after `since`, ascending by
 * `startedAt`, and answers the same question the same way twice.
 */
export interface ResultSource {
  fetchRuns(since: Date): Promise<TestRun[]>;
}
