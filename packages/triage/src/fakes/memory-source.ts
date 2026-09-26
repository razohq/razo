import type { TestRun } from '../core/model';
import type { ResultSource } from '../ports/result-source';

/** In-memory ResultSource: the reference implementation of the contract. */
export class MemoryResultSource implements ResultSource {
  constructor(private readonly runs: TestRun[]) {}

  async fetchRuns(since: Date): Promise<TestRun[]> {
    return structuredClone(
      this.runs
        .filter((run) => Date.parse(run.finishedAt) >= since.getTime())
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    );
  }
}
