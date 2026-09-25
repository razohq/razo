import { unzipSync } from 'fflate';
import type { RazoReport } from '../adapters/razo-source/layout';

const RETRY_SUFFIX = /-retry(\d+)$/;
const REPORT_NAME = /(^|\/)(razo|ai)-steps\.json$/;

/** A report bigger than this is not a report razo wrote. Also bounds a hostile entry. */
export const MAX_REPORT_BYTES = 8_000_000;

/**
 * Every razo-steps.json inside a test-results archive, with its retry index.
 * Traces, videos and screenshots that Playwright puts next to them are never
 * inflated: the filter runs before decompression.
 */
export function reportsFromZip(
  zip: Buffer,
  options: { maxEntryBytes?: number } = {},
): Array<{ report: RazoReport; retry: number; path: string }> {
  const max = options.maxEntryBytes ?? MAX_REPORT_BYTES;
  const entries = unzipSync(new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength), {
    filter: (file) => REPORT_NAME.test(file.name) && file.originalSize <= max,
  });
  const found: Array<{ report: RazoReport; retry: number; path: string }> = [];
  for (const [entryPath, bytes] of Object.entries(entries)) {
    const parts = entryPath.split('/');
    let report: RazoReport;
    try {
      report = JSON.parse(Buffer.from(bytes).toString('utf8')) as RazoReport;
    } catch (error) {
      throw new Error(`${entryPath}: invalid JSON in razo-steps.json (${error instanceof Error ? error.message : String(error)})`);
    }
    const dir = parts[parts.length - 2] ?? '';
    const fromDir = Number(dir.match(RETRY_SUFFIX)?.[1] ?? 0);
    const retry = typeof report.retry === 'number' && report.retry >= 0 ? report.retry : fromDir;
    found.push({ report, retry, path: entryPath });
  }
  return found;
}
