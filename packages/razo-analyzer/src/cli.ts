#!/usr/bin/env node
import * as fs from 'fs';
import { analyzeFailures, describeApiError, validateProviderOptions, type ProviderName } from './analyze';
import { upsertPrComment } from './github';
import { batchReports, buildPrompt, promptBudget } from './prompt';
import { loadFailedReports } from './reports';

const USAGE = `Usage: razo-analyze [target] [options]

Analyzes razo razo-steps.json artifacts of failed tests with Claude and
prints a business-level failure analysis in Markdown.

Arguments:
  target              An razo-steps.json file or a directory to scan
                      (default: test-results)

Options:
  --out <file>        Also write the analysis to a file
  --pr-comment        Post/update the analysis as a PR comment (GitHub Actions)
  --provider <name>   Model provider: anthropic (default) or openai
  --model <id>        Model id (default for anthropic: claude-opus-4-8;
                      required with --provider openai)
  --dry-run           Print the prompt instead of calling the API
  -h, --help          Show this help

Credentials: ANTHROPIC_API_KEY (or \`ant auth login\`) for anthropic;
OPENAI_API_KEY for openai. The analysis prompt is designed and tested with
Claude — verdict quality with other models may vary.`;

interface CliArgs {
  target: string;
  out?: string;
  prComment: boolean;
  provider: string;
  model?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { target: 'test-results', prComment: false, provider: 'anthropic', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--out') {
      args.out = argv[++i];
    } else if (arg === '--provider') {
      args.provider = argv[++i];
    } else if (arg === '--model') {
      args.model = argv[++i];
    } else if (arg === '--pr-comment') {
      args.prComment = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}\n\n${USAGE}`);
      process.exit(2);
    } else {
      args.target = arg;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const providerError = validateProviderOptions(args.provider, args.model, process.env);
  if (providerError) {
    console.error(`${providerError}\n\n${USAGE}`);
    process.exit(2);
  }

  if (!fs.existsSync(args.target)) {
    console.error(`Target not found: ${args.target}\n\n${USAGE}`);
    process.exit(2);
  }

  const failed = loadFailedReports(args.target);
  if (failed.length === 0) {
    console.log('No failed tests found — nothing to analyze.');
    return;
  }
  const batches = batchReports(failed, promptBudget());
  console.error(
    `Analyzing ${failed.length} failed test(s)` +
      (batches.length > 1 ? ` → ${batches.length} batches (budget ${promptBudget()} chars)` : '') +
      '...',
  );

  if (args.dryRun) {
    console.log(batches.map((batch) => buildPrompt(batch)).join('\n\n===== NEXT BATCH =====\n\n'));
    return;
  }

  let analysis: string;
  try {
    analysis = await analyzeFailures(failed, {
      provider: args.provider as ProviderName,
      model: args.model,
    });
  } catch (error) {
    console.error(describeApiError(error));
    process.exit(1);
  }

  console.log(analysis);
  if (args.out) fs.writeFileSync(args.out, analysis + '\n');
  if (args.prComment) {
    await upsertPrComment(analysis);
    console.error('PR comment posted.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
