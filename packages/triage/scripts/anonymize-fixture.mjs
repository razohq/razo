#!/usr/bin/env node
// Deterministic anonymizer for razo-steps.json from projects we do not own.
// Only needed if a third-party project's data is ever captured. Rewrites
// report contents, not directory names: re-run capture-run.mjs afterwards if
// the slugs matter.
//
//   node scripts/anonymize-fixture.mjs <fixture-dir> --salt <secret>
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const WORDS = [
  'amber', 'birch', 'cobalt', 'delta', 'ember', 'fjord', 'granite', 'harbor', 'indigo', 'juniper',
  'kestrel', 'lumen', 'maple', 'nectar', 'onyx', 'pebble', 'quartz', 'raven', 'sable', 'tundra',
  'umber', 'violet', 'willow', 'xenon', 'yarrow', 'zephyr',
];

/** Two dictionary words picked by a salted hash of the original value. */
function token(value, salt, style) {
  const digest = createHash('sha256').update(`${salt}\u0000${value}`).digest();
  const pick = (i) => WORDS[(digest[i] * 256 + digest[i + 1]) % WORDS.length];
  const [a, b] = [pick(0), pick(2)];
  if (style === 'kebab') return `${a}-${b}`;
  return `${a[0].toUpperCase()}${a.slice(1)} ${b}`;
}

function remember(dictionary, value, salt, style) {
  const key = `${style}:${value}`;
  if (!dictionary.has(key)) dictionary.set(key, token(value, salt, style));
  return dictionary.get(key);
}

/** Same word count as the original, each word replaced deterministically. */
function phrase(value, dictionary, salt) {
  return value.split(/\s+/).map((w) => remember(dictionary, w.toLowerCase(), salt, 'kebab').split('-')[0]).join(' ');
}

const ABSOLUTE_PATH = /(?:[A-Za-z]:)?(?:\/[\w.-]+){2,}\/?/g;

/** Replaces every known name (longest first, so "place-order" wins over "order") and drops absolute paths. */
function scrubText(text, names) {
  let out = text.replace(ABSOLUTE_PATH, (m) => (/\.(spec|test)\.[cm]?[jt]s/.test(m) ? path.basename(m) : '<path>'));
  for (const [original, replacement] of [...names].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(original).join(replacement);
  }
  return out;
}

export function anonymizeReport(report, dictionary, salt) {
  const names = new Map();
  for (const step of report.steps) {
    // An empty name would be found between every two characters; it has nothing to hide anyway.
    if (step.name) names.set(step.name, remember(dictionary, step.name, salt, 'title'));
    const selectors = [step.selector, step.healed?.from, step.healed?.to].filter(Boolean);
    for (const selector of selectors) {
      for (const q of selector.matchAll(/["']([^"']+)["']/g)) if (q[1]) names.set(q[1], remember(dictionary, q[1], salt, 'kebab'));
    }
  }
  // The spec is replaced as a whole file name (x.spec.ts), never as a bare word: a short
  // name such as "x" would otherwise be rewritten inside every word that contains it.
  const specName = report.file.match(/([^/]+)\.(spec|test)\.([cm]?[jt]s)$/);
  if (specName) {
    const ext = `.${specName[2]}.${specName[3]}`;
    names.set(`${specName[1]}${ext}`, `${remember(dictionary, specName[1], salt, 'kebab')}${ext}`);
  }

  const out = { ...report, test: phrase(report.test, dictionary, salt) };
  if (specName) out.file = report.file.replace(`${specName[1]}.${specName[2]}.${specName[3]}`, names.get(`${specName[1]}.${specName[2]}.${specName[3]}`));
  if (report.error) out.error = scrubText(report.error, names);
  out.steps = report.steps.map((step) => {
    const s = { ...step, name: step.name ? names.get(step.name) : step.name };
    s.selector = scrubText(step.selector, names);
    s.sentence = scrubText(step.sentence, names);
    for (const key of ['detail', 'expected', 'actual', 'error']) {
      if (typeof s[key] === 'string') s[key] = scrubText(s[key], names);
    }
    if (s.healed) s.healed = { from: scrubText(s.healed.from, names), to: scrubText(s.healed.to, names) };
    if (s.domCandidates) s.domCandidates = s.domCandidates.map((c) => scrubText(c, names));
    return s;
  });
  return out;
}

function main() {
  const [dir, ...rest] = process.argv.slice(2);
  const salt = rest[rest.indexOf('--salt') + 1];
  if (!dir || rest.indexOf('--salt') === -1 || !salt) {
    console.error('usage: anonymize-fixture.mjs <fixture-dir> --salt <secret>');
    process.exit(2);
  }
  const dictionary = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'razo-steps.json') {
        const report = JSON.parse(fs.readFileSync(p, 'utf8'));
        fs.writeFileSync(p, JSON.stringify(anonymizeReport(report, dictionary, salt), null, 2) + '\n');
      } else if (e.name === 'run.json') {
        const manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
        delete manifest.ciUrl;
        fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
      } else if (e.name === 'commits.json') {
        const commits = JSON.parse(fs.readFileSync(p, 'utf8')).map((c, i) => {
          const { url: _url, ...rest } = c;
          return { ...rest, author: `author-${i + 1}`, message: phrase(c.message, dictionary, salt) };
        });
        fs.writeFileSync(p, JSON.stringify(commits, null, 2) + '\n');
      }
    }
  };
  walk(dir);
  console.log(`anonymized ${dir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
