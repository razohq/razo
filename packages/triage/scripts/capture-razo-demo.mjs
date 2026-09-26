#!/usr/bin/env node
// Rebuilds the razo-demo PR #1 fixture: runs Playwright at the base sha and at
// the PR head sha of a local clone of razohq/razo-demo, captures both runs, and
// writes commits.json with the real diffs between them.
//
//   node scripts/capture-razo-demo.mjs [--repo ../../../../razo-demo] [--base bea5183] [--head 80a6543]
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { writeRun } = require(path.resolve(here, '../dist/index.js'));

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i === -1 ? fallback : argv[i + 1]; };
const repo = path.resolve(here, opt('repo', '../../../../razo-demo'));
const base = opt('base', 'bea5183');
const head = opt('head', '80a6543');
const out = path.resolve(here, '../fixtures/razo-demo-pr-1');
const REMOTE = 'https://github.com/razohq/razo-demo';

const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const full = (ref) => git('rev-parse', ref);
const dateOf = (sha) => git('log', '-1', '--format=%aI', sha);

function collectReports(dir) {
  const reports = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'razo-steps.json') reports.push({
        report: JSON.parse(fs.readFileSync(p, 'utf8')),
        retry: Number(path.basename(d).match(/-retry(\d+)$/)?.[1] ?? 0),
      });
    }
  };
  walk(dir);
  return reports;
}

/**
 * Both runs are recorded on `main`: the PR head is what main would have
 * become the night after merging, which is the situation the triage models.
 * prNumber keeps the provenance visible.
 */
function runAt(sha, id, prNumber) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), `razo-demo-${id}-`));
  git('worktree', 'add', '--detach', wt, sha);
  try {
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(wt, 'node_modules'));
    const t0 = Date.now();
    try { execFileSync('npx', ['playwright', 'test'], { cwd: wt, stdio: 'ignore' }); } catch { /* red runs exit 1 */ }
    const elapsed = Date.now() - t0;
    const reports = collectReports(path.join(wt, 'test-results'));
    // Timestamps follow the commit, not today: the fixture must read like the night the PR was opened.
    const startedAt = new Date(Date.parse(dateOf(sha)) + 60_000).toISOString();
    const finishedAt = new Date(Date.parse(startedAt) + Math.max(elapsed, 1000)).toISOString();
    const manifest = { id, sha: full(sha), branch: 'main', startedAt, finishedAt, ciUrl: `${REMOTE}/commit/${full(sha)}` };
    if (prNumber) manifest.prNumber = prNumber;
    writeRun(out, manifest, reports);
    return reports.length;
  } finally {
    git('worktree', 'remove', '--force', wt);
  }
}

fs.rmSync(out, { recursive: true, force: true });
console.log(`green @ ${base}: ${runAt(base, `base-${base}`)} report(s)`);
console.log(`red   @ ${head}: ${runAt(head, `pr-1-${head}`, 1)} report(s)`);

// The base commit comes first: CodeContext.commitsBetween(base, head) excludes it
// from the range but must know it, or a fake context rejects the sha as unknown.
const shas = [full(base), ...git('log', '--no-merges', '--reverse', '--format=%H', `${base}..${head}`).split('\n').filter(Boolean)];
const commits = shas.map((sha) => {
  const [message, author, date] = git('log', '-1', '--format=%s%n%an%n%aI', sha).split('\n');
  const files = git('show', '--format=', '--name-status', sha).split('\n').filter(Boolean).map((line) => {
    const [code, ...rest] = line.split('\t');
    const filename = rest[rest.length - 1];
    const status = { A: 'added', M: 'modified', D: 'removed', R: 'renamed' }[code[0]];
    const patch = git('show', '--format=', sha, '--', filename);
    return { filename, ...(status ? { status } : {}), ...(patch ? { patch } : {}) };
  });
  return { sha, message, author, date, url: `${REMOTE}/commit/${sha}`, files };
});
fs.writeFileSync(path.join(out, 'commits.json'), JSON.stringify(commits, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'README.md'), `# razo-demo PR #1

Real runs of ${REMOTE} at the base commit (${base}, green) and at the head of
pull request #1 (${head}, red), regenerated with \`scripts/capture-razo-demo.mjs\`.
Both are recorded on branch \`main\`: the PR head is what main would have
become the night after merging, which is the situation the triage models;
\`prNumber\` keeps the provenance. \`commits.json\` lists the base commit followed by the ${commits.length - 1}
non-merge commits up to the head in git's topological order (author dates are
not monotonic: the PR commit predates the merge-base commit), with their diffs
and VCS status. The PR hides
the Place order button and removes the Mouse row, so two tests fail; the
expected verdict for the Place order test is stale-test with medium
confidence. Not synthetic.
`);
console.log(`commits.json: ${commits.length} commit(s)`);
