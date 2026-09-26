import type { ChangedFile, Commit } from '../../core/model';
import type { CodeContext } from '../../ports/code-context';
import { GitHubApi, GitHubApiError } from './api';

interface CompareCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } };
}

interface ComparePage {
  total_commits: number;
  commits: CompareCommit[];
}

/** GitHub serves at most 100 commits per compare page whatever per_page asks. */
const MAX_COMPARE_PAGE = 100;

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
      const perPage = Math.min(this.options.perPage ?? MAX_COMPARE_PAGE, MAX_COMPARE_PAGE);
      const commits: CompareCommit[] = [];
      // Walk until total_commits is reached: a page shorter than requested is not the end when the server caps pages.
      for (let page = 1; ; page++) {
        const body = await this.api.getJson<ComparePage>(
          `/repos/${this.repo}/compare/${fromSha}...${toSha}?per_page=${perPage}&page=${page}`,
        );
        commits.push(...body.commits);
        if (body.commits.length === 0 || commits.length >= body.total_commits) break;
      }
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
