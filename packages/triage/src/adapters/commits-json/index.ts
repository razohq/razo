import * as fs from 'fs';
import type { ChangedFile, Commit } from '../../core/model';
import type { CodeContext } from '../../ports/code-context';
import type { ConfigSchema, TriagePlugin } from '../../ports/plugin';

type StoredCommit = Commit & { files: ChangedFile[] };

/**
 * CodeContext over a commits.json like the fixtures carry: chronological
 * commits with their files. For offline runs and tests; no network.
 */
export class CommitsJsonCodeContext implements CodeContext {
  private commits?: StoredCommit[];

  constructor(private readonly file: string) {}

  private load(): StoredCommit[] {
    if (!this.commits) {
      if (!fs.existsSync(this.file)) throw new Error(`commits.json not found: ${this.file}`);
      this.commits = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoredCommit[];
    }
    return this.commits;
  }

  private indexOf(sha: string): number {
    const index = this.load().findIndex((c) => c.sha === sha);
    if (index === -1) throw new Error(`unknown commit: ${sha}`);
    return index;
  }

  async commitsBetween(fromSha: string, toSha: string): Promise<Commit[]> {
    const from = this.indexOf(fromSha);
    const to = this.indexOf(toSha);
    return this.load().slice(from + 1, to + 1).map(({ files: _files, ...commit }) => structuredClone(commit));
  }

  async changedFiles(sha: string): Promise<ChangedFile[]> {
    return structuredClone(this.load()[this.indexOf(sha)].files);
  }
}

export interface CommitsJsonConfig {
  path: string;
}

const configSchema: ConfigSchema<CommitsJsonConfig> = {
  parse(input: unknown): CommitsJsonConfig {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('commits-json config must be an object');
    const { path } = input as Record<string, unknown>;
    if (typeof path !== 'string' || path.length === 0) throw new Error('commits-json config needs a non-empty "path"');
    return { path };
  },
};

export const commitsJsonCodePlugin: TriagePlugin<'code', CommitsJsonConfig> = {
  name: 'commits-json',
  kind: 'code',
  configSchema,
  create: (config) => new CommitsJsonCodeContext(config.path),
};
