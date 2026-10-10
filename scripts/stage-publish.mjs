#!/usr/bin/env node
// Stages every public workspace whose version is not on npm yet, for a
// maintainer to approve with 2FA (`npm stage approve <id>` or npmjs.com).
// Replaces `changeset publish` in the release workflow: npm stage is not
// workspace-aware, so each package is staged from its own directory.
//
// CI's short-lived OIDC token can stage but cannot run `npm stage list`, so
// a version already staged is recognized by its git tag (`<name>@<version>`,
// the tag changesets used to create), pushed right after staging. A rejected
// stage keeps its tag: delete the tag to stage that version again.
//
//   node scripts/stage-publish.mjs [--dry-run]
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

function onNpm(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() === version;
  } catch {
    return false; // E404: the package or the version does not exist
  }
}

const remoteTags = new Set(
  run('git', ['ls-remote', '--tags', 'origin']).split('\n').filter(Boolean).map((line) => line.split('refs/tags/')[1]),
);

const workspaces = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces;
const dirs = workspaces.flatMap((pattern) => {
  if (!pattern.endsWith('/*')) return [pattern];
  const parent = path.join(root, pattern.slice(0, -2));
  return fs.readdirSync(parent).map((d) => path.join(pattern.slice(0, -2), d));
});

let staged = 0;
for (const dir of dirs) {
  const manifest = path.join(root, dir, 'package.json');
  if (!fs.existsSync(manifest)) continue;
  const { name, version, private: isPrivate } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (isPrivate) continue;
  const tag = `${name}@${version}`;
  if (onNpm(name, version)) {
    console.log(`${tag}: already published`);
    continue;
  }
  if (remoteTags.has(tag)) {
    console.log(`${tag}: already staged, waiting for approval`);
    continue;
  }
  if (dryRun) {
    console.log(`${tag}: would stage from ${dir}`);
    staged += 1;
    continue;
  }
  run('npm', ['stage', 'publish'], path.join(root, dir));
  run('git', ['tag', tag]);
  run('git', ['push', 'origin', tag]);
  console.log(`${tag}: staged; approve it with \`npm stage approve <id>\` (see \`npm stage list ${name}\`) or on npmjs.com`);
  staged += 1;
}
console.log(staged === 0 ? 'Nothing to stage.' : `${dryRun ? 'Would stage' : 'Staged'} ${staged} package(s).`);
