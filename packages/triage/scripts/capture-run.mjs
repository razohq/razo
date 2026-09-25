#!/usr/bin/env node
// Captures a Playwright `test-results` directory written by razo's reporter
// as one run in the triage layout. Retries are detected from `-retryN` dirs
// (or from the report's own `retry` field when present).
//
//   node scripts/capture-run.mjs <test-results-dir> --data-dir <dir> --id <runId> \
//     --sha <sha> --branch <branch> [--started <iso>] [--finished <iso>] \
//     [--ci-url <url>] [--pr <n>] [--synthetic]
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { writeRun } = require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js'));

const FLAGS = new Set(['synthetic']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[key] = FLAGS.has(key) ? true : argv[++i];
  }
  return args;
}

function findReports(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findReports(full));
    else if (entry.name === 'razo-steps.json') out.push(full);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const [resultsDir] = args._;
for (const key of ['dataDir', 'id', 'sha', 'branch']) {
  if (!args[key]) { console.error(`missing --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`); process.exit(2); }
}
if (!resultsDir || !fs.existsSync(resultsDir)) { console.error(`test-results dir not found: ${resultsDir}`); process.exit(2); }

const reports = findReports(resultsDir).map((file) => {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fromDir = Number(path.basename(path.dirname(file)).match(/-retry(\d+)$/)?.[1] ?? 0);
  return { report, retry: typeof report.retry === 'number' ? report.retry : fromDir };
});
if (reports.length === 0) { console.error(`no razo-steps.json under ${resultsDir}`); process.exit(1); }

const timestamps = reports.flatMap((r) => r.report.steps.map((s) => Date.parse(s.timestamp))).filter(Number.isFinite);
const totalMs = reports.reduce((sum, r) => sum + r.report.durationMs, 0);
const startedAt = args.started ?? new Date(timestamps.length ? Math.min(...timestamps) : Date.now()).toISOString();
const finishedAt = args.finished ?? new Date(Date.parse(startedAt) + Math.max(totalMs, 1000)).toISOString();

const manifest = { id: args.id, sha: args.sha, branch: args.branch, startedAt, finishedAt };
if (args.ciUrl) manifest.ciUrl = args.ciUrl;
if (args.pr) manifest.prNumber = Number(args.pr);
if (args.synthetic) manifest.synthetic = true;

const runDir = writeRun(args.dataDir, manifest, reports);
console.log(`captured ${reports.length} report(s) → ${runDir}`);
