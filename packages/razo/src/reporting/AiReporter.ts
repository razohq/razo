import * as fs from 'fs';
import * as path from 'path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { AI_STEP_ATTACHMENT, stripAnsi, type StepEvent } from './events';
import { AI_SIGNAL_ATTACHMENT, attributeSignals, type PageSignal } from './signals';

/** Per-test artifact: the full narration, ready for an AI analyzer. */
export interface AiTestReport {
  test: string;
  file: string;
  status: TestResult['status'];
  durationMs: number;
  /** Test-level error (failure outside a narrated step, or failure summary) */
  error?: string;
  steps: StepEvent[];
  /** Console errors, uncaught exceptions, failed requests and 5xx answers, oldest first. Absent when there were none. */
  signals?: PageSignal[];
  /** The first signal at or before the failure: a hint at the cause, never a verdict. */
  firstAnomaly?: PageSignal;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function testFileBase(file: string): string {
  return path.basename(file).replace(/\.(spec|test)\.(ts|mts|cts|js|mjs|cjs)$/, '');
}

export interface AiReporterOptions {
  /** Where to write the artifacts, relative to the Playwright config file. Default: 'test-results'. */
  outputDir?: string;
}

/**
 * Custom reporter: for each test it collects the StepEvents that traveled
 * as attachments and writes <outputDir>/<test>/razo-steps.json.
 */
export default class AiReporter implements Reporter {
  private outputDir: string;

  constructor(options: AiReporterOptions = {}) {
    this.outputDir = options.outputDir ?? 'test-results';
  }

  onBegin(config: FullConfig) {
    // config.rootDir resolves to the testDir; the project root is where the config file lives.
    const projectRoot = config.configFile ? path.dirname(config.configFile) : process.cwd();
    this.outputDir = path.resolve(projectRoot, this.outputDir);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const steps = result.attachments
      .filter((a) => a.name === AI_STEP_ATTACHMENT && a.body)
      .map((a) => JSON.parse(a.body!.toString()) as StepEvent);
    const raw = result.attachments
      .filter((a) => a.name === AI_SIGNAL_ATTACHMENT && a.body)
      .map((a) => JSON.parse(a.body!.toString()) as PageSignal);
    const { signals, firstAnomaly } = attributeSignals(raw, steps);

    const report: AiTestReport = {
      test: test.title,
      file: path.relative(path.dirname(this.outputDir), test.location.file),
      status: result.status,
      durationMs: result.duration,
      error: result.error?.message ? stripAnsi(result.error.message) : undefined,
      steps,
      ...(signals.length > 0 ? { signals } : {}),
      // Only a failure has a cause to hint at.
      ...(firstAnomaly && result.status !== 'passed' && result.status !== 'skipped' ? { firstAnomaly } : {}),
    };

    const retrySuffix = result.retry > 0 ? `-retry${result.retry}` : '';
    const dir = path.join(
      this.outputDir,
      `${slug(testFileBase(test.location.file))}-${slug(test.title)}${retrySuffix}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'razo-steps.json'), JSON.stringify(report, null, 2) + '\n');
  }

  printsToStdio() {
    return false;
  }
}
