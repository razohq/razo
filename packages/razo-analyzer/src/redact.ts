// Secret patterns and the environment-value masking are adapted from
// playwright-smart-reporter (src/agent/redact.ts), MIT License,
// Copyright (c) 2024 Gary Parker (full text in THIRD-PARTY-NOTICES.md).
// The per-step masking of sensitive controls is razo's own.
import type { AiTestReport, PageSignal, StepEvent } from './types';

export const REDACTED = '[REDACTED]';

// Env var names whose values must never leave the machine.
const SENSITIVE_ENV_NAME =
  /token|secret|passw(?:or)?d|api[-_]?key|apikey|access[-_]?key|private[-_]?key|credential|auth|session|cookie|webhook|dsn|signature|(?:^|_)(?:pass|pwd|key|pat)$/i;

// Shorter values are too likely to occur by chance in ordinary text.
const MIN_ENV_VALUE_LENGTH = 8;

// A key ending in a source-file extension is a path such as secrets.spec.ts:14:61, not a credential.
const KV_KEY =
  '[\\w.-]*(?:passw(?:or)?d|secret|token|api[-_]?key|apikey|access[-_]?key|private[-_]?key|credential|session[-_]?id|signature)[\\w.-]*(?<!\\.(?:[cm]?[jt]sx?|json|ya?ml|feature|html?|txt|log))';

const NOT_REDACTED = '(?!\\[REDACTED\\])';

const RULES: Array<[RegExp, string | ((match: string, prefix: string) => string)]> = [
  [/-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END[A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  [/\b((?:proxy-)?authorization["']?\s*[:=]\s*["']?)(?:[A-Za-z0-9-]+\s+)?[^\s"',;]+/gi, `$1${REDACTED}`],
  [/\b((?:set-)?cookie["']?\s*[:=]\s*["']?)[^\r\n"']+/gi, `$1${REDACTED}`],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  [/\beyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, REDACTED],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\brz_[A-Za-z0-9_-]{16,}/g, REDACTED], // razo.ar ingest tokens
  [/([?&](?:key|sig|code|jwt|token|access_token|auth|sid)=)[^&#\s]+/gi, `$1${REDACTED}`],
  [
    new RegExp(`(${KV_KEY}["']?\\s*[:=]\\s*)${NOT_REDACTED}(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\s&;,"'<>)}\\]]+)`, 'gi'),
    (match, prefix) => {
      const value = match.slice(prefix.length);
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
      return `${prefix}${quote}${REDACTED}${quote}`;
    },
  ],
];

/**
 * A control whose value is a secret, judged by its name or selector: what a
 * test types into it, or asserts it holds, is masked wherever it appears.
 */
const SENSITIVE_CONTROL =
  /passw(?:or)?d|passcode|secret|token|api[-_ ]?key|credential|\botp\b|one[-_ ]time|\bpin\b|\bcvc\b|\bcvv\b|security[-_ ]code|card[-_ ]?number|\bssn\b/i;

export interface Redactor {
  string(value: string): string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Masks known secret shapes and the values of credential-like environment variables. */
export function createRedactor(env: Record<string, string | undefined> = process.env): Redactor {
  const envValues = Object.entries(env)
    .filter(([name, value]) => SENSITIVE_ENV_NAME.test(name) && typeof value === 'string' && value.length >= MIN_ENV_VALUE_LENGTH)
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
  const envPattern = envValues.length > 0 ? new RegExp(envValues.map(escapeRegExp).join('|'), 'g') : undefined;
  return {
    string(value) {
      let out = envPattern ? value.replace(envPattern, REDACTED) : value;
      for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement as string);
      return out;
    },
  };
}

const maskValues = (text: string, values: string[]) =>
  [...values].sort((a, b) => b.length - a.length).reduce((out, v) => out.split(v).join(REDACTED), text);

/** What a step typed into, or asserted on, a sensitive control; empty for any other step. */
function sensitiveValues(step: StepEvent): string[] {
  if (!SENSITIVE_CONTROL.test(step.name) && !SENSITIVE_CONTROL.test(step.selector)) return [];
  return [step.detail, step.expected, step.actual].filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function redactStep(step: StepEvent, redactor: Redactor): StepEvent {
  const out: StepEvent = { ...step };
  const values = sensitiveValues(step);
  if (values.length > 0) {
    if (step.detail !== undefined) out.detail = REDACTED;
    if (step.expected !== undefined) out.expected = REDACTED;
    if (step.actual !== undefined) out.actual = REDACTED;
    out.sentence = maskValues(step.sentence, values);
    if (step.error !== undefined) out.error = maskValues(step.error, values);
  }
  for (const key of ['sentence', 'detail', 'expected', 'actual', 'error'] as const) {
    const value = out[key];
    if (typeof value === 'string') out[key] = redactor.string(value);
  }
  if (out.domCandidates) out.domCandidates = out.domCandidates.map((c) => redactor.string(c));
  return out;
}

/** A copy of the report with secrets masked; the input is not modified. */
export function redactReport(report: AiTestReport, redactor: Redactor = createRedactor()): AiTestReport {
  const steps = report.steps.map((s) => redactStep(s, redactor));
  const values = report.steps.flatMap(sensitiveValues);
  const text = (value: string) => redactor.string(maskValues(value, values));
  const signal = (sig: PageSignal): PageSignal => ({
    ...sig,
    text: text(sig.text),
    ...(sig.url !== undefined ? { url: text(sig.url) } : {}),
    ...(sig.afterStep !== undefined ? { afterStep: text(sig.afterStep) } : {}),
  });
  return {
    ...report,
    ...(report.error !== undefined ? { error: text(report.error) } : {}),
    steps,
    ...(report.signals ? { signals: report.signals.map(signal) } : {}),
    ...(report.firstAnomaly ? { firstAnomaly: signal(report.firstAnomaly) } : {}),
  };
}
