import type { CodeContext } from '../ports/code-context';
import type { ChangedFile, Commit, SuspectCommit, TouchedControl } from './model';

const MIN_NEEDLE = 4;

/** Tokens that name a kind of thing, not a specific control; they would match half a codebase. */
const GENERIC = new Set([
  'btn', 'button', 'buttons', 'input', 'field', 'link', 'label', 'table', 'row', 'cell', 'item', 'items',
  'list', 'text', 'title', 'name', 'main', 'form', 'menu', 'icon', 'nav', 'card', 'header', 'footer',
  'content', 'container', 'wrapper', 'primary', 'secondary', 'active', 'disabled', 'hidden', 'visible',
  'error', 'page', 'root', 'body', 'html', 'div', 'span', 'true', 'false', 'null', 'none', 'value',
  'data', 'test', 'testid',
]);

/**
 * Strings that identify a control in source: its human name plus anything
 * quoted inside its selector (a testid, a role name). Short or generic
 * tokens are dropped: they would turn every commit into a suspect. Same idea
 * as razo-cloud's change-context, reimplemented here so the core imports
 * nothing from it.
 */
export function needlesFor(control: TouchedControl): string[] {
  const quoted = [...control.selector.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  return [...new Set([control.name, ...quoted])].filter(
    (n) => n.length >= MIN_NEEDLE && !GENERIC.has(n.toLowerCase()),
  );
}

const ALNUM = /[A-Za-z0-9]/;

/** True when `needle` occurs in `line` as a whole token: not glued to other letters or digits. */
function containsToken(line: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = line.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : line[at - 1];
    const after = line[at + needle.length] ?? '';
    if (!ALNUM.test(before) && !ALNUM.test(after)) return true;
    from = at + 1;
  }
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A file whose name carries one of the needles: the component's own source file, most likely. */
function fileNamesControl(filename: string, needles: string[]): boolean {
  const name = normalize(filename);
  return needles.some((n) => name.includes(normalize(n)));
}

/** Added and removed lines only; `+++`/`---` carry filenames, not content. */
export function changedLines(patch: string): string[] {
  return patch.split('\n').filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
}

const describe = (c: TouchedControl) => `${c.controlType} "${c.name}"`;

export interface SuspectInput {
  controls: TouchedControl[];
  /** Chronological, as CodeContext.commitsBetween returns them. */
  commits: Commit[];
  changedFiles: (sha: string) => Promise<ChangedFile[]>;
}

/** A changed file that names a component of the test but cannot be read: evidence, never a score. */
export interface UnevaluableFile {
  sha: string;
  filename: string;
  components: string[];
  reason: 'no patch' | 'removed';
}

export interface SuspectSearch {
  suspects: SuspectCommit[];
  unevaluable: UnevaluableFile[];
}

/**
 * Commits whose diff names a control the test drove, best first: by number
 * of overlapping controls, then most recent. A commit that names nothing is
 * not a suspect; the caller shows the sha range as evidence instead. Files
 * without a patch, or removed, that carry a component's name in their own
 * name are reported as unevaluable rather than guessed at.
 */
export async function findSuspects(input: SuspectInput, max = 3): Promise<SuspectSearch> {
  const needles = input.controls
    .map((control) => ({ control, needles: needlesFor(control) }))
    .filter((n) => n.needles.length > 0);
  if (needles.length === 0 || input.commits.length === 0) return { suspects: [], unevaluable: [] };

  const suspects: SuspectCommit[] = [];
  const unevaluable = new Map<string, UnevaluableFile>();
  for (const commit of input.commits) {
    const files = await input.changedFiles(commit.sha);
    const lines: string[] = [];
    for (const file of files) {
      const blocked = file.status === 'removed' ? 'removed' : !file.patch ? 'no patch' : null;
      if (blocked) {
        const components = needles.filter((n) => fileNamesControl(file.filename, n.needles)).map((n) => describe(n.control));
        if (components.length > 0) {
          const key = `${commit.sha}\u0000${file.filename}`;
          const known = unevaluable.get(key);
          if (known) known.components = [...new Set([...known.components, ...components])];
          else unevaluable.set(key, { sha: commit.sha, filename: file.filename, components, reason: blocked });
        }
        continue;
      }
      lines.push(...changedLines(file.patch!));
    }
    if (lines.length === 0) continue;
    const overlapping = new Set<string>();
    for (const { control, needles: ns } of needles) {
      if (lines.some((line) => ns.some((n) => containsToken(line, n)))) overlapping.add(describe(control));
    }
    if (overlapping.size > 0) {
      suspects.push({
        sha: commit.sha,
        message: commit.message,
        author: commit.author,
        overlappingComponents: [...overlapping],
        score: overlapping.size,
      });
    }
  }
  const dateOf = new Map(input.commits.map((c) => [c.sha, c.date]));
  return {
    suspects: suspects
      .sort((a, b) => b.score - a.score || (dateOf.get(b.sha) ?? '').localeCompare(dateOf.get(a.sha) ?? ''))
      .slice(0, max),
    unevaluable: [...unevaluable.values()].slice(0, max),
  };
}

/** The commits that turned a test red. Empty when the history lacks either end of the range. */
export async function commitsInRange(
  code: CodeContext,
  range: { lastGreenSha?: string; firstRedSha?: string },
): Promise<Commit[]> {
  if (!range.lastGreenSha || !range.firstRedSha) return [];
  return code.commitsBetween(range.lastGreenSha, range.firstRedSha);
}
