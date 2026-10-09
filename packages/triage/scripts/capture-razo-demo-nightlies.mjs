#!/usr/bin/env node
// Rebuilds the razo-demo-nightlies fixture: copies the main runs that
// `triage pull` downloaded from razohq/razo-demo into the fixture as they are,
// and writes commits.json with every commit from the first run's sha to the
// last one, read from a local clone.
//
//   node scripts/capture-razo-demo-nightlies.mjs --data-dir ~/razo-triage/.razo \
//     [--repo ../../../../razo-demo] [--until 2026-10-09T02:00:00Z]
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i === -1 ? fallback : argv[i + 1]; };
const dataDir = opt('data-dir');
if (!dataDir) { console.error('missing --data-dir'); process.exit(2); }
const repo = path.resolve(here, opt('repo', '../../../../razo-demo'));
const until = Date.parse(opt('until', '2026-10-09T02:00:00Z'));
const out = path.resolve(here, '../fixtures/razo-demo-nightlies');
const REMOTE = 'https://github.com/razohq/razo-demo';

const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

const runsDir = path.join(dataDir, 'runs');
const runs = fs.readdirSync(runsDir)
  .map((id) => ({ id, manifest: JSON.parse(fs.readFileSync(path.join(runsDir, id, 'run.json'), 'utf8')) }))
  .filter(({ manifest }) => manifest.branch === 'main' && Date.parse(manifest.finishedAt) <= until)
  .sort((a, b) => a.manifest.startedAt.localeCompare(b.manifest.startedAt));
if (runs.length === 0) { console.error(`no main runs under ${runsDir}`); process.exit(1); }

fs.rmSync(out, { recursive: true, force: true });
for (const { id } of runs) fs.cpSync(path.join(runsDir, id), path.join(out, 'runs', id), { recursive: true });

// The first run's sha comes first: CodeContext.commitsBetween excludes it from
// every range but must know it. History on main is linear, merges included.
const first = runs[0].manifest.sha;
const last = runs[runs.length - 1].manifest.sha;
const shas = [first, ...git('log', '--reverse', '--topo-order', '--format=%H', `${first}..${last}`).split('\n').filter(Boolean)];
const commits = shas.map((sha) => {
  const [message, author, date, parents] = git('log', '-1', '--format=%s%n%an%n%aI%n%P', sha).split('\n');
  const files = git('show', '--first-parent', '--format=', '--name-status', sha).split('\n').filter(Boolean).map((line) => {
    const [code, ...rest] = line.split('\t');
    const filename = rest[rest.length - 1];
    const status = { A: 'added', M: 'modified', D: 'removed', R: 'renamed' }[code[0]];
    const patch = git('show', '--first-parent', '--format=', sha, '--', filename);
    return { filename, ...(status ? { status } : {}), ...(patch ? { patch } : {}) };
  });
  return { sha, message, author, date, url: `${REMOTE}/commit/${sha}`, parents: parents.split(' ').filter(Boolean), files };
});
fs.writeFileSync(path.join(out, 'commits.json'), JSON.stringify(commits, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'README.md'), `# razo-demo nightlies

Real runs of ${REMOTE} on \`main\`, ${runs[0].manifest.finishedAt.slice(0, 10)} to
${runs[runs.length - 1].manifest.finishedAt.slice(0, 10)}: the scheduled nightlies plus the push runs of
each merge, as \`triage pull\` downloaded them (${runs.length} runs), regenerated with
\`scripts/capture-razo-demo-nightlies.mjs\`. \`commits.json\` lists every
commit from the first run's sha to the last one, merges included with
their first-parent diff and their parents.

The calibration broke main three times on purpose and reverted it each
time (razo-demo PRs #3/#4, #5/#6, #8/#9): hiding Place order (stale-test)
and changing the SAVE10 amount (regression). So the history holds three
red streaks, each closed by green runs, and the last one opens and closes
inside a single 24-hour window. Not synthetic.
`);
console.log(`${runs.length} run(s), ${commits.length} commit(s) → ${out}`);
