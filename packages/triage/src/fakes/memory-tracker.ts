import type { IssueDraft, IssueRef } from '../core/model';
import type { IssueTracker } from '../ports/issue-tracker';

interface StoredIssue {
  signature: string;
  ref: IssueRef;
  comments: string[];
}

/** In-memory IssueTracker. Exposes what was created and commented for assertions. */
export class MemoryIssueTracker implements IssueTracker {
  private readonly issues: StoredIssue[];
  private nextKey = 1;

  constructor(
    readonly name: string,
    seeded: Array<{ signature: string; ref: IssueRef }> = [],
  ) {
    this.issues = seeded.map(({ signature, ref }) => ({
      signature,
      ref: { ...ref, tracker: name },
      comments: [],
    }));
  }

  async findBySignature(signature: string): Promise<IssueRef[]> {
    return this.issues.filter((i) => i.signature === signature).map((i) => structuredClone(i.ref));
  }

  async create(draft: IssueDraft): Promise<IssueRef> {
    const key = `${this.name.toUpperCase()}-${this.nextKey++}`;
    const ref: IssueRef = { tracker: this.name, key, url: `memory://${this.name}/${key}`, status: 'open' };
    this.issues.push({ signature: draft.signature, ref, comments: [] });
    return structuredClone(ref);
  }

  async comment(issue: IssueRef, body: string): Promise<void> {
    const stored = this.issues.find((i) => i.ref.key === issue.key);
    if (!stored) throw new Error(`unknown issue: ${issue.key}`);
    stored.comments.push(body);
  }

  /** Comments recorded on an issue, for tests. */
  commentsOn(key: string): string[] {
    return [...(this.issues.find((i) => i.ref.key === key)?.comments ?? [])];
  }
}
