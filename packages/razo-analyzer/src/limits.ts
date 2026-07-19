import type { AiTestReport, StepEvent } from './types';

/**
 * Mirrors of the hosted ingest's zod caps (apps/web/src/lib/ingest-validation.ts).
 * They live here as local constants because after the open-core split this
 * package cannot import from the private app; a unit test on the web side
 * compares both to catch drift. The server REJECTS oversized payloads, so
 * the uploader must truncate below these numbers — never at the consumer.
 */
export const MAX_ERROR_CHARS = 20_000;
export const MAX_STEPS_PER_REPORT = 500;
export const MAX_PAYLOAD_BYTES = 2_000_000;
export const MAX_REPORTS = 200;
export const MAX_FIELD_CHARS = 2_048;
export const MAX_SENTENCE_CHARS = 1_024;
export const MAX_NAME_CHARS = 256;
export const MAX_TEST_CHARS = 512;
export const MAX_SELECTOR_CHARS = 512;

const TRUNCATION_SUFFIX = '… [truncated]';
/** Headroom for the run metadata and JSON framing around the reports array. */
const PAYLOAD_HEADROOM_BYTES = 1_000;

function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

function cutOptional(value: string | undefined, max: number): string | undefined {
  return value === undefined ? undefined : cut(value, max);
}

/**
 * Collapses a step list to `maxSteps`, always keeping every failed step,
 * then the first/last passed ones, and inserting one synthetic marker step
 * where the middle was dropped. Also used by the analyzer's prompt budget.
 */
export function trimStepsTo(
  steps: StepEvent[],
  maxSteps: number,
  reason = 'razo-upload (size limit)',
): StepEvent[] {
  if (steps.length <= maxSteps) return steps;
  const budget = Math.max(maxSteps - 1, 1); // one slot for the marker
  const failedIndexes = steps.flatMap((s, i) => (s.status === 'failed' ? [i] : []));
  const keep = new Set<number>();
  for (const i of failedIndexes.slice(0, budget)) keep.add(i);
  const passedBudget = budget - keep.size;
  if (passedBudget > 0) {
    const passedIndexes = steps.flatMap((s, i) => (s.status === 'failed' ? [] : [i]));
    const head = Math.ceil(passedBudget / 2);
    const tail = passedBudget - head;
    for (const i of passedIndexes.slice(0, head)) keep.add(i);
    if (tail > 0) for (const i of passedIndexes.slice(-tail)) keep.add(i);
  }
  const kept = [...keep].sort((a, b) => a - b);
  const omitted = steps.length - kept.length;
  const result: StepEvent[] = [];
  let markerPlaced = false;
  for (let k = 0; k < kept.length; k++) {
    const index = kept[k];
    if (!markerPlaced && k > 0 && index > kept[k - 1] + 1) {
      result.push({
        action: 'omitted',
        controlType: 'razo',
        name: 'truncation',
        sentence: `… ${omitted} steps omitted by ${reason} …`,
        selector: '-',
        status: 'passed',
        timestamp: steps[kept[k - 1]].timestamp,
      });
      markerPlaced = true;
    }
    result.push(steps[index]);
  }
  if (!markerPlaced) {
    result.push({
      action: 'omitted',
      controlType: 'razo',
      name: 'truncation',
      sentence: `… ${omitted} steps omitted by ${reason} …`,
      selector: '-',
      status: 'passed',
      timestamp: steps[steps.length - 1].timestamp,
    });
  }
  return result;
}

function truncateStep(step: StepEvent): StepEvent {
  return {
    ...step,
    name: cut(step.name, MAX_NAME_CHARS),
    sentence: cut(step.sentence, MAX_SENTENCE_CHARS),
    selector: cut(step.selector, MAX_SELECTOR_CHARS),
    detail: cutOptional(step.detail, MAX_FIELD_CHARS),
    expected: cutOptional(step.expected, MAX_FIELD_CHARS),
    actual: cutOptional(step.actual, MAX_FIELD_CHARS),
    error: cutOptional(step.error, MAX_ERROR_CHARS),
    domCandidates: step.domCandidates?.slice(0, 5).map((c) => cut(c, 256)),
  };
}

/** Truncates every oversized field and collapses oversized step lists. */
export function truncateReport(
  report: AiTestReport,
): { report: AiTestReport; trimmed: boolean } {
  const out: AiTestReport = {
    ...report,
    test: cut(report.test, MAX_TEST_CHARS),
    file: cut(report.file, MAX_TEST_CHARS),
    error: cutOptional(report.error, MAX_ERROR_CHARS),
    steps: trimStepsTo(report.steps, MAX_STEPS_PER_REPORT).map(truncateStep),
  };
  const trimmed = JSON.stringify(out) !== JSON.stringify(report);
  return { report: trimmed ? out : report, trimmed };
}

function isFailed(report: AiTestReport): boolean {
  return report.status !== 'passed' && report.status !== 'skipped';
}

function sizeOf(reports: AiTestReport[]): number {
  return Buffer.byteLength(JSON.stringify(reports), 'utf8');
}

/**
 * Truncates every report and, if the set still exceeds the server limits,
 * drops the heaviest PASSED reports first (failed ones carry the analysis
 * value), then — pathological case — shrinks the heaviest failed ones.
 */
export function prepareUploadReports(reports: AiTestReport[]): {
  reports: AiTestReport[];
  trimmedReports: number;
  droppedPassed: number;
} {
  let trimmedReports = 0;
  let out = reports.map((r) => {
    const { report, trimmed } = truncateReport(r);
    if (trimmed) trimmedReports += 1;
    return report;
  });

  const budget = MAX_PAYLOAD_BYTES - PAYLOAD_HEADROOM_BYTES;
  let droppedPassed = 0;
  const overLimit = () => out.length > MAX_REPORTS || sizeOf(out) > budget;

  while (overLimit()) {
    const passed = out.filter((r) => !isFailed(r));
    if (passed.length > 0) {
      const heaviest = passed.reduce((a, b) => (sizeOf([a]) >= sizeOf([b]) ? a : b));
      out = out.filter((r) => r !== heaviest);
      droppedPassed += 1;
      continue;
    }
    // Only failed reports left and still over: shrink the heaviest one hard.
    const heaviest = out.reduce((a, b) => (sizeOf([a]) >= sizeOf([b]) ? a : b));
    const shrunk: AiTestReport = {
      ...heaviest,
      steps: trimStepsTo(heaviest.steps, Math.max(Math.floor(heaviest.steps.length / 2), 3)),
    };
    if (JSON.stringify(shrunk) === JSON.stringify(heaviest)) {
      // Cannot shrink further: drop it rather than loop forever.
      out = out.filter((r) => r !== heaviest);
    } else {
      out = out.map((r) => (r === heaviest ? shrunk : r));
    }
    trimmedReports += 1;
  }

  // Report untouched inputs as the original array for byte-identical no-ops.
  if (trimmedReports === 0 && droppedPassed === 0) {
    return { reports, trimmedReports: 0, droppedPassed: 0 };
  }
  return { reports: out, trimmedReports, droppedPassed };
}
