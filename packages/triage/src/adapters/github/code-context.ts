import type { ChangedFile, Commit } from '../../core/model';
import type { CodeContext } from '../../ports/code-context';
import { GitHubApi, GitHubApiError } from './api';

interface CompareCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } };
}

interface CommitResponse {
  files?: Array<{ filename: string; status: string; patch?: string }>;
}

const STATUSES = new Set(['added', 'modified', 'removed', 'renamed']);

/** CodeContext over the GitHub REST API: compare for ranges, commits for files. Needs contents:read. */
export class GitHubCodeContext implements CodeContext {
  constructor(
    private readonly api: GitHubApi,
    private readonly repo: string,
    private readonly options: { perPage?: number } = {},
  ) {}

  async commitsBetween(fromSha: string, toSha: string): Promise<Commit[]> {
    try {
      const commits = await this.api.getAll<CompareCommit>(
        `/repos/${this.repo}/compare/${fromSha}...${toSha}`,
        (page) => (page as { commits: CompareCommit[] }).commits,
        this.options.perPage ?? 250,
      );
      return commits.map((c) => ({
        sha: c.sha,
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name,
        date: c.commit.author.date,
        url: c.html_url,
      }));
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
        throw new Error(`unknown commit range ${fromSha}...${toSha} in ${this.repo}`);
      }
      throw error;
    }
  }

  async changedFiles(sha: string): Promise<ChangedFile[]> {
    try {
      const commit = await this.api.getJson<CommitResponse>(`/repos/${this.repo}/commits/${sha}`);
      return (commit.files ?? []).map((f) => ({
        filename: f.filename,
        ...(STATUSES.has(f.status) ? { status: f.status as ChangedFile['status'] } : {}),
        ...(f.patch ? { patch: f.patch } : {}),
      }));
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) throw new Error(`unknown commit ${sha} in ${this.repo}`);
      throw error;
    }
  }
}
