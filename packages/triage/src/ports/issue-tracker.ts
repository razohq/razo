import type { IssueDraft, IssueRef } from '../core/model';

/**
 * Ticket system. Only `findBySignature` runs unattended; `create` and
 * `comment` are invoked exclusively after a recorded human approval.
 * Contract: lookup by signature is exact, and a created issue is findable
 * by its draft's signature right away.
 */
export interface IssueTracker {
  findBySignature(signature: string): Promise<IssueRef[]>;
  create(draft: IssueDraft): Promise<IssueRef>;
  comment(issue: IssueRef, body: string): Promise<void>;
}
