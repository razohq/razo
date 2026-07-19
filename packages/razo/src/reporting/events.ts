import { test } from '@playwright/test';

/**
 * Structured event that accompanies every narrated sentence.
 * This is the artifact an AI analyzer consumes: one entry per action
 * or assertion, with status and business context.
 */
export interface StepEvent {
  /** Grammar verb: 'click', 'fill', 'assert-text', ... */
  action: string;
  /** Control type: 'button', 'input', 'select', ... */
  controlType: string;
  /** Human-readable control name ("Export", "Filename") */
  name: string;
  /** The sentence exactly as it appears in the Playwright report */
  sentence: string;
  /** Action payload (typed text, chosen option) */
  detail?: string;
  /** Assertions only: what was expected */
  expected?: string;
  /** Failed assertions only: what was actually found */
  actual?: string;
  /** Stable selector of the control */
  selector: string;
  status: 'passed' | 'failed';
  /** Error message when status === 'failed' */
  error?: string;
  /** Set when the primary locator stopped resolving and a fallback found the element. */
  healed?: { from: string; to: string };
  /** Failed locator-not-found steps: same-role elements on the page, for the analyzer. */
  domCandidates?: string[];
  timestamp: string;
}

/** Artifacts are meant for an AI, not a terminal: no ANSI codes. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Attachment name under which events travel to the reporter. */
export const AI_STEP_ATTACHMENT = 'ai-step';

/**
 * Emits a StepEvent as an attachment of the running test. Attachments
 * cross the worker → reporter boundary, so AiReporter can collect them
 * in onTestEnd without shared state.
 */
export function emitStepEvent(event: StepEvent): void {
  test.info().attachments.push({
    name: AI_STEP_ATTACHMENT,
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(event)),
  });
}
