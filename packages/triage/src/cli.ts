#!/usr/bin/env node
import { loadConfig } from './config/load';
import { parseDuration, runPull, runTriage } from './commands';

const USAGE = `Usage:
  triage run  [--config triage.config.yaml] [--since 24h] [--lookback 14d] [--now <iso>]
  triage pull [--config triage.config.yaml] [--since 7d] [--data-dir <dir>]

run   reads the runs of the last --lookback, triages the failures since --since,
      and sends the report to every notifier in the config.
pull  downloads razo test-results artifacts from GitHub Actions (config.pull)
      into the razo-source dataDir. Token needs actions:read and contents:read.

Durations: <n>m, <n>h, <n>d, or an ISO date.`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

const FLAGS: Record<string, Set<string>> = {
  run: new Set(['config', 'since', 'lookback', 'now']),
  pull: new Set(['config', 'since', 'data-dir', 'now']),
};

function parseArgs(argv: string[]): { command?: string; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    }
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!command || !FLAGS[command]?.has(name)) fail(`unknown flag: --${name}`);
      flags[name] = argv[++i] ?? '';
    } else if (!command) command = a;
    else fail(`unexpected argument: ${a}`);
  }
  return { command, flags };
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command !== 'run' && command !== 'pull') fail(command ? `unknown command: ${command}` : 'missing command');
  const now = flags.now ? new Date(flags.now) : new Date();
  if (Number.isNaN(now.getTime())) fail(`invalid --now: ${flags.now}`);
  const duration = (text: string): Date => {
    try {
      return parseDuration(text, now);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
  // Usage errors before any file is read: a bad flag is exit 2 whether or not the config exists.
  const since = duration(flags.since ?? (command === 'pull' ? '7d' : '24h'));
  const lookback = command === 'run' ? duration(flags.lookback ?? '14d') : now;
  const config = loadConfig(flags.config ?? 'triage.config.yaml');

  if (command === 'pull') {
    if (!config.pull) fail('config has no "pull" section (repo, token, workflow?, branch?, artifactPrefix?)');
    const sourceDir = (config.source.config as { dataDir?: string } | undefined)?.dataDir;
    const dataDir = flags['data-dir'] ?? sourceDir;
    if (!dataDir) fail('no data dir: pass --data-dir or configure source.config.dataDir');
    const summary = await runPull(config, { since, dataDir, log: (line) => console.error(line) });
    console.log(`pulled ${summary.pulled.length} run(s), skipped ${summary.skipped.length}`);
    for (const s of summary.skipped) console.log(`  skipped ${s.runId}: ${s.reason}`);
    return;
  }

  const result = await runTriage(config, { now, since, lookback });
  const { report } = result;
  console.log(`triage ${report.generatedAt}: ${report.totals.tests} tests, ${report.totals.failures} failures, ${report.totals.clusters} clusters`);
  for (const item of report.items) {
    const first = item.cluster.failures[0]?.testId ?? '';
    const title = first.includes('::') ? first.split('::')[1] : first;
    console.log(`  ${item.verdict.category} · ${item.verdict.confidence} · ${title}`);
  }
  console.log(`sent to ${result.notified} notifier${result.notified === 1 ? '' : 's'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
