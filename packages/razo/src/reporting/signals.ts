import { test, type Page, type TestInfo } from '@playwright/test';

/**
 * Something the page did that a test step did not ask for and that points at
 * the app rather than the test: a console error, an uncaught exception, a
 * request that failed or a 5xx answer. Recorded live from page events, so it
 * needs no trace.
 */
export interface PageSignal {
  kind: 'console-error' | 'page-error' | 'request-failed' | 'http-error';
  /** One line a person reads: the console text, the exception, or `POST <url> → 503`. */
  text: string;
  method?: string;
  url?: string;
  /** http-error only. */
  status?: number;
  timestamp: string;
  /** Set by the reporter: the last step that had finished when it happened, usually the action that set it off. */
  afterStep?: string;
}

/** Attachment name under which signals travel to the reporter. */
export const AI_SIGNAL_ATTACHMENT = 'ai-signal';
/** A page in a loop of errors must not bury the report. */
export const MAX_SIGNALS_PER_TEST = 50;
const MAX_TEXT = 500;
const MAX_URL = 2_048;

/** The client gave up on the request (navigation away, a cancelled fetch): not the app failing. */
const CANCELLED = /ERR_ABORTED|NS_BINDING_ABORTED|cancell?ed/i;
/** Chromium repeats every failed or 4xx/5xx load as a console error; the request signal already has it. */
const NETWORK_ECHO = 'Failed to load resource:';

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

const observed = new WeakSet<Page>();
const counts = new WeakMap<TestInfo, number>();

function emit(signal: Omit<PageSignal, 'timestamp' | 'afterStep'>): void {
  let info: TestInfo;
  try {
    info = test.info();
  } catch {
    return; // fired between tests, or after the test ended: nobody to attribute it to
  }
  const n = counts.get(info) ?? 0;
  if (n >= MAX_SIGNALS_PER_TEST) return;
  counts.set(info, n + 1);
  const event: PageSignal = {
    ...signal,
    text: cut(signal.text, MAX_TEXT),
    ...(signal.url ? { url: cut(signal.url, MAX_URL) } : {}),
    timestamp: new Date().toISOString(),
  };
  info.attachments.push({ name: AI_SIGNAL_ATTACHMENT, contentType: 'application/json', body: Buffer.from(JSON.stringify(event)) });
}

/**
 * Starts recording a page's signals for the running test. Every control calls
 * it on first use, so only what happens before the first control (the initial
 * `page.goto`, typically) needs an explicit call. Idempotent per page.
 */
export function observePage(page: Page): void {
  if (observed.has(page)) return;
  observed.add(page);
  page.on('console', (message) => {
    if (message.type() !== 'error' || message.text().startsWith(NETWORK_ECHO)) return;
    emit({ kind: 'console-error', text: message.text() });
  });
  page.on('pageerror', (error) => emit({ kind: 'page-error', text: error.message }));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'failed';
    if (CANCELLED.test(failure)) return;
    emit({ kind: 'request-failed', method: request.method(), url: request.url(), text: `${request.method()} ${request.url()} failed (${failure})` });
  });
  page.on('response', (response) => {
    if (response.status() < 500) return;
    const method = response.request().method();
    emit({ kind: 'http-error', method, url: response.url(), status: response.status(), text: `${method} ${response.url()} → ${response.status()}` });
  });
}

/**
 * Which step each signal followed, and the first signal before the failure.
 * A StepEvent's timestamp is when its step ended: a click returns before the
 * request it starts is answered, so the useful link is the last step that had
 * finished, not the one still waiting. The failure moment is the end of the
 * first failed step, or the end of the test when no narrated step failed.
 */
export function attributeSignals(
  signals: PageSignal[],
  steps: Array<{ sentence: string; status: string; timestamp: string }>,
): { signals: PageSignal[]; firstAnomaly?: PageSignal } {
  const ordered = [...signals].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const withStep = ordered.map((s) => {
    const before = steps.filter((e) => e.timestamp <= s.timestamp);
    return before.length > 0 ? { ...s, afterStep: before[before.length - 1].sentence } : s;
  });
  const failedAt = steps.find((e) => e.status === 'failed')?.timestamp;
  const firstAnomaly = withStep.find((s) => failedAt === undefined || s.timestamp <= failedAt);
  return { signals: withStep, ...(firstAnomaly ? { firstAnomaly } : {}) };
}
