import { clusterIdOf } from '../../core/signature';
import type { IssueDraft, IssueRef } from '../../core/model';
import type { IssueTracker } from '../../ports/issue-tracker';
import type { GitHubApi } from './api';

interface GitHubIssue {
  number: number;
  html_url: string;
  state: string;
  body?: string | null;
}

/**
 * The line that ties an issue to a failure: the cluster id, derived from the
 * signature. A whole line, so `razo-triage: abc` never matches `abc0`.
 */
export function issueMarker(signature: string): string {
  return `razo-triage: ${clusterIdOf(signature)}`;
}

const hasMarker = (body: string | null | undefined, marker: string) =>
  (body ?? '').split(/\r?\n/).some((line) => line.trim() === marker);

/** GitHub rejects a new-issue URL much longer than this; the body is shortened, never the marker. */
const MAX_URL = 8000;

/**
 * GitHub Issues as a tracker. The morning only calls `findBySignature` and
 * `newIssueUrl`, which read; `create` and `comment` exist for the contract and
 * for callers that act after a person approved, and fail with a read-only token.
 * Lookups use the search API, which indexes a new issue within minutes.
 */
export class GitHubIssueTracker implements IssueTracker {
  readonly name = 'github';

  constructor(private readonly api: GitHubApi, private readonly repo: string) {}

  private ref(issue: GitHubIssue): IssueRef {
    return { tracker: this.name, key: `#${issue.number}`, url: issue.html_url, status: issue.state };
  }

  async findBySignature(signature: string): Promise<IssueRef[]> {
    const marker = issueMarker(signature);
    const q = `repo:${this.repo} is:issue in:body "${marker}"`;
    const page = await this.api.getJson<{ items: GitHubIssue[] }>(`/search/issues?q=${encodeURIComponent(q)}&per_page=100`);
    // Search is a loose text match; only an exact marker line counts.
    return page.items.filter((issue) => hasMarker(issue.body, marker)).map((issue) => this.ref(issue));
  }

  private bodyWithMarker(draft: IssueDraft): string {
    return `${draft.body}\n\n${issueMarker(draft.signature)}`;
  }

  async create(draft: IssueDraft): Promise<IssueRef> {
    const issue = await this.api.postJson<GitHubIssue>(`/repos/${this.repo}/issues`, {
      title: draft.title, body: this.bodyWithMarker(draft), labels: draft.labels,
    });
    return this.ref(issue);
  }

  async comment(issue: IssueRef, body: string): Promise<void> {
    const number = issue.key.replace(/^#/, '');
    if (!/^\d+$/.test(number)) throw new Error(`not a GitHub issue key: ${issue.key}`);
    await this.api.postJson(`/repos/${this.repo}/issues/${number}/comments`, { body });
  }

  /** GitHub's new-issue form filled with the draft: a person reviews it and creates the issue. */
  newIssueUrl(draft: IssueDraft): string {
    const build = (body: string) => {
      const params = new URLSearchParams({ title: draft.title, body: `${body}\n\n${issueMarker(draft.signature)}` });
      if (draft.labels.length > 0) params.set('labels', draft.labels.join(','));
      return `https://github.com/${this.repo}/issues/new?${params.toString()}`;
    };
    let body = draft.body;
    let url = build(body);
    while (url.length > MAX_URL && body.length > 0) {
      body = `${body.slice(0, Math.max(0, body.length - (url.length - MAX_URL) - 40))}\n…`;
      if (body.length <= 2) body = '';
      url = build(body);
    }
    return url;
  }
}
