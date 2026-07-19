import * as fs from 'fs';
import * as path from 'path';
import type { AiTestReport } from './types';

/** Finds every razo-steps.json under the target (or the file itself). */
export function findReportFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];

  const found: string[] = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) found.push(...findReportFiles(entryPath));
    else if (entry.name === 'razo-steps.json' || entry.name === 'ai-steps.json') found.push(entryPath); // legacy name accepted
  }
  return found.sort();
}

export function loadFailedReports(target: string): AiTestReport[] {
  return findReportFiles(target)
    .map((file) => JSON.parse(fs.readFileSync(file, 'utf8')) as AiTestReport)
    .filter((report) => report.status !== 'passed' && report.status !== 'skipped');
}
