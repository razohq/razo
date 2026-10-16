import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

/** Prints every step title, Playwright's own API calls included, as one JSON line. */
export default class TitlesReporter implements Reporter {
  private titles: string[] = [];
  private status = '';
  private error = '';
  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep) { this.titles.push(step.title); }
  onTestEnd(_test: TestCase, result: TestResult) { this.status = result.status; this.error = result.error?.message ?? ''; }
  onEnd() { process.stdout.write(JSON.stringify({ status: this.status, error: this.error, titles: this.titles })); }
  printsToStdio() { return true; }
}
