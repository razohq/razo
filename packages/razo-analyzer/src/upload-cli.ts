#!/usr/bin/env node
import { prepareUploadReports } from './limits';
import { buildUploadPayload, loadAllReports, uploadReports } from './upload';

const USAGE = `Usage: razo-upload [target] --url <ingest-url> --token <rz_...>

Uploads razo razo-steps.json artifacts to a razo dashboard.
Defaults: target=test-results, url=$RAZO_INGEST_URL, token=$RAZO_INGEST_TOKEN.`;

async function main() {
  const argv = process.argv.slice(2);
  let target = 'test-results';
  let url = process.env.RAZO_INGEST_URL;
  let token = process.env.RAZO_INGEST_TOKEN;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { console.log(USAGE); return; }
    else if (arg === '--url') url = argv[++i];
    else if (arg === '--token') token = argv[++i];
    else if (arg.startsWith('-')) { console.error(`Unknown option: ${arg}\n\n${USAGE}`); process.exit(2); }
    else target = arg;
  }
  if (!url || !token) { console.error(`Missing --url or --token.\n\n${USAGE}`); process.exit(2); }

  const loaded = loadAllReports(target);
  if (loaded.length === 0) { console.log('No razo-steps.json found — nothing to upload.'); return; }
  const { reports, trimmedReports, droppedPassed } = prepareUploadReports(loaded);
  if (trimmedReports > 0 || droppedPassed > 0) {
    // Never trim silently — the artifact on disk stays complete.
    console.error(
      `Trimmed ${trimmedReports} report(s) to fit server limits; dropped ${droppedPassed} passed report(s).`,
    );
  }
  await uploadReports(url, token, buildUploadPayload(reports));
  console.log(`Uploaded ${reports.length} report(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
