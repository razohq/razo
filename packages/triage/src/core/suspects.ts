import type { CodeContext } from '../ports/code-context';
import type { ChangedFile, Commit, SuspectCommit, TouchedControl } from './model';

const MIN_NEEDLE = 3;

/**
 * Strings that identify a control in source: its human name plus anything
 * quoted inside its selector (a testid, a role name). Two characters or fewer
 * match half a codebase, so they are dropped. Same rule as razo-cloud's
 * change-context, reimplemented here so the core imports nothing from it.
 */
export function needlesFor(control: TouchedControl): string[] {
  const quoted = [...control.selector.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  return [...new Set([control.name, ...quoted])].filter((n) => n.length >= MIN_NEEDLE);
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

/**
 * Commits whose diff names a control the test drove, best first: by number
 * of overlapping controls, then most recent. A commit that names nothing is
 * not a suspect; the caller shows the sha range as evidence instead.
 */
export async function findSuspects(input: SuspectInput, max = 3): Promise<SuspectCommit[]> {
  const needles = input.controls
    .map((control) => ({ control, needles: needlesFor(control) }))
    .filter((n) => n.needles.length > 0);
  if (needles.length === 0 || input.commits.length === 0) return [];

  const suspects: SuspectCommit[] = [];
  for (const commit of input.commits) {
    const lines = (await input.changedFiles(commit.sha)).flatMap((f) => (f.patch ? changedLines(f.patch) : []));
    if (lines.length === 0) continue;
    const overlapping = new Set<string>();
    for (const { control, needles: ns } of needles) {
      if (lines.some((line) => ns.some((n) => line.includes(n)))) overlapping.add(describe(control));
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
  return suspects
    .sort((a, b) => b.score - a.score || (dateOf.get(b.sha) ?? '').localeCompare(dateOf.get(a.sha) ?? ''))
    .slice(0, max);
}

/** The commits that turned a test red. Empty when the history lacks either end of the range. */
export async function commitsInRange(
  code: CodeContext,
  range: { lastGreenSha?: string; firstRedSha?: string },
): Promise<Commit[]> {
  if (!range.lastGreenSha || !range.firstRedSha) return [];
  return code.commitsBetween(range.lastGreenSha, range.firstRedSha);
}
