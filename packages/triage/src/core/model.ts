/**
 * Canonical data model (DESIGN.md §5). The core reasons only about these
 * types; adapters translate to and from them. Any field an adapter cannot
 * fill honestly stays optional rather than guessed.
 */

export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

export interface TestRun {
  id: string;
  sha: string;
  branch: string;
  /** ISO 8601 */
  startedAt: string;
  finishedAt: string;
  /** Name of the ResultSource plugin that produced it. */
  source: string;
  results: TestResult[];
}

export interface TestResult {
  /** Stable across runs: file + full title + project. */
  testId: string;
  title: string;
  file: string;
  project?: string;
  /** Final status after retries. */
  status: TestStatus;
  /** Every attempt, retries included, in order. */
  attempts: Attempt[];
  durationMs: number;
  workerIndex?: number;
  error?: TestError;
  /** Controls the test drove, e.g. `button "Place order"`, derived from `controls`. */
  touchedComponents?: string[];
  /** The same controls with their selector, so suspects can match testids and role names in diffs. */
  controls?: TouchedControl[];
  /** Steps whose primary locator stopped resolving and healed to another. Evidence for stale-test, never a confidence boost. */
  healedLocators?: Array<{ from: string; to: string }>;
  traceUrl?: string;
}

export interface Attempt {
  status: TestStatus;
  durationMs: number;
  error?: TestError;
}

export interface TouchedControl {
  controlType: string;
  name: string;
  selector: string;
}

export interface TestError {
  message: string;
  stack?: string;
  /** `errorSignature(message)`: the core computes it, adapters copy it. */
  signature: string;
}

export type Category = 'regression' | 'flaky' | 'environment' | 'stale-test' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';
export type ClusterState = 'new' | 'acknowledged' | 'ticketed' | 'flaky' | 'ignored' | 'resolved';

export interface Cluster {
  /** `clusterIdOf(signature)` */
  id: string;
  signature: string;
  failures: FailureRef[];
  category: Category;
  confidence: Confidence;
  novelty: 'new' | 'recurring';
  firstSeenAt: string;
  lastSeenAt: string;
  lastGreenSha?: string;
  firstRedSha?: string;
  suspectCommits: SuspectCommit[];
  linkedIssue?: IssueRef;
  state: ClusterState;
}

export interface FailureRef {
  runId: string;
  testId: string;
  sha: string;
}

export interface SuspectCommit {
  sha: string;
  message: string;
  author: string;
  /** Components touched by both the test and the commit. */
  overlappingComponents: string[];
  score: number;
}

export interface Evidence {
  kind: 'sha-range' | 'commit' | 'signature' | 'retry' | 'history' | 'trace';
  description: string;
  url?: string;
}

export interface Verdict {
  clusterId: string;
  category: Category;
  confidence: Confidence;
  summary: string;
  nextStep: string;
  evidence: Evidence[];
  origin: 'rules' | 'llm';
  /** Set when the LLM contradicted the rules; both views are reported. */
  disagreement?: string;
}

export interface IssueRef {
  tracker: string;
  key: string;
  url: string;
  status: string;
}

export interface IssueDraft {
  title: string;
  body: string;
  signature: string;
  labels: string[];
}

export interface TriageReport {
  generatedAt: string;
  window: { from: string; to: string };
  totals: { tests: number; failures: number; clusters: number };
  items: Array<{ cluster: Cluster; verdict: Verdict; proposedActions: ProposedAction[] }>;
}

export type ProposedAction =
  | { type: 'create-issue'; draft: IssueDraft }
  | { type: 'comment-issue'; issue: IssueRef; body: string }
  | { type: 'mark-flaky' }
  | { type: 'quarantine' }
  | { type: 'ignore' };

export interface Commit {
  sha: string;
  message: string;
  author: string;
  /** ISO 8601 */
  date: string;
  url?: string;
}

/** One file a commit changed. `patch` is the unified diff; absent for binary or oversized entries. */
export interface ChangedFile {
  filename: string;
  patch?: string;
}
