/**
 * The razo artifact contract, mirrored here so the analyzer works standalone
 * against any razo-steps.json — no runtime dependency on the razo package.
 * Keep in sync with razo's StepEvent / AiTestReport.
 */

export interface StepEvent {
  action: string;
  controlType: string;
  name: string;
  sentence: string;
  detail?: string;
  expected?: string;
  actual?: string;
  selector: string;
  status: 'passed' | 'failed';
  error?: string;
  /** Set when the primary locator stopped resolving and a fallback found the element. */
  healed?: { from: string; to: string };
  /** Failed locator-not-found steps: same-role elements on the page. */
  domCandidates?: string[];
  timestamp: string;
}

/** What the page did unasked: console errors, uncaught exceptions, failed requests, 5xx answers. */
export interface PageSignal {
  kind: 'console-error' | 'page-error' | 'request-failed' | 'http-error';
  text: string;
  method?: string;
  url?: string;
  status?: number;
  timestamp: string;
  /** The last step that had finished when it happened. */
  afterStep?: string;
}

export interface AiTestReport {
  test: string;
  file: string;
  status: string;
  durationMs: number;
  error?: string;
  steps: StepEvent[];
  signals?: PageSignal[];
  /** The first signal at or before the failure. */
  firstAnomaly?: PageSignal;
}
