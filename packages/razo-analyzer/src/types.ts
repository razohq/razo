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

export interface AiTestReport {
  test: string;
  file: string;
  status: string;
  durationMs: number;
  error?: string;
  steps: StepEvent[];
}
