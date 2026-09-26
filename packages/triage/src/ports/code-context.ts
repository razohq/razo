import type { ChangedFile, Commit } from '../core/model';

/**
 * Read-only view of the repository. Contract: `commitsBetween` excludes
 * `fromSha`, includes `toSha`, is chronological, and both methods reject on
 * a SHA they do not know rather than answering with an empty list.
 */
export interface CodeContext {
  commitsBetween(fromSha: string, toSha: string): Promise<Commit[]>;
  changedFiles(sha: string): Promise<ChangedFile[]>;
}
