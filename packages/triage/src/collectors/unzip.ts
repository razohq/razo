import { unzipSync } from 'fflate';
import type { RazoReport } from '../adapters/razo-source/layout';

const RETRY_SUFFIX = /-retry(\d+)$/;

/** Every razo-steps.json inside a test-results archive, with its retry index. Other files are ignored. */
export function reportsFromZip(zip: Buffer): Array<{ report: RazoReport; retry: number; path: string }> {
  const entries = unzipSync(new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength));
  const found: Array<{ report: RazoReport; retry: number; path: string }> = [];
  for (const [entryPath, bytes] of Object.entries(entries)) {
    const parts = entryPath.split('/');
    const name = parts[parts.length - 1];
    if (name !== 'razo-steps.json' && name !== 'ai-steps.json') continue;
    const report = JSON.parse(Buffer.from(bytes).toString('utf8')) as RazoReport;
    const dir = parts[parts.length - 2] ?? '';
    const fromDir = Number(dir.match(RETRY_SUFFIX)?.[1] ?? 0);
    const retry = typeof report.retry === 'number' && report.retry >= 0 ? report.retry : fromDir;
    found.push({ report, retry, path: entryPath });
  }
  return found;
}
