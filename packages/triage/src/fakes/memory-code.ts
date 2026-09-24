import type { ChangedFile, Commit } from '../core/model';
import type { CodeContext } from '../ports/code-context';

export type MemoryCommit = Commit & { files: ChangedFile[] };

/** In-memory CodeContext over a chronological commit list. */
export class MemoryCodeContext implements CodeContext {
  constructor(private readonly commits: MemoryCommit[]) {}

  private indexOf(sha: string): number {
    const index = this.commits.findIndex((c) => c.sha === sha);
    if (index === -1) throw new Error(`unknown commit: ${sha}`);
    return index;
  }

  async commitsBetween(fromSha: string, toSha: string): Promise<Commit[]> {
    const from = this.indexOf(fromSha);
    const to = this.indexOf(toSha);
    return this.commits.slice(from + 1, to + 1).map(({ files: _files, ...commit }) => structuredClone(commit));
  }

  async changedFiles(sha: string): Promise<ChangedFile[]> {
    return structuredClone(this.commits[this.indexOf(sha)].files);
  }
}
