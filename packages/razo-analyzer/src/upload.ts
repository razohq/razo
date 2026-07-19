import * as fs from 'fs';
import { prepareUploadReports } from './limits';
import { findReportFiles } from './reports';
import type { AiTestReport } from './types';

export interface UploadRunMeta {
  branch?: string;
  commitSha?: string;
  prNumber?: number;
  ciUrl?: string;
}

export interface UploadPayload {
  run: UploadRunMeta;
  reports: AiTestReport[];
}

/** Builds the ingest payload, reading CI metadata from GitHub Actions env vars. */
export function buildUploadPayload(
  reports: AiTestReport[],
  env: Record<string, string | undefined> = process.env,
): UploadPayload {
  const run: UploadRunMeta = {};
  if (env.GITHUB_REF_NAME) run.branch = env.GITHUB_REF_NAME;
  if (env.GITHUB_SHA) run.commitSha = env.GITHUB_SHA;
  const prMatch = env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//);
  if (prMatch) run.prNumber = Number(prMatch[1]);
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) {
    run.ciUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  }
  // Always fit the server's hard limits: an oversized payload is rejected
  // whole (400) and the entire run would be lost. Idempotent, so callers
  // that already prepared the reports pay nothing.
  return { run, reports: prepareUploadReports(reports).reports };
}

export function loadAllReports(target: string): AiTestReport[] {
  return findReportFiles(target).map(
    (file) => JSON.parse(fs.readFileSync(file, 'utf8')) as AiTestReport,
  );
}

export async function uploadReports(
  url: string,
  token: string,
  payload: UploadPayload,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Upload failed: ${response.status} ${body.slice(0, 300)}`);
  }
}
