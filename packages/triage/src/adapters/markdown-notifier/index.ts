import * as fs from 'fs';
import * as path from 'path';
import type { TriageReport } from '../../core/model';
import type { Notifier } from '../../ports/notifier';
import type { ConfigSchema, TriagePlugin } from '../../ports/plugin';
import { renderMarkdown } from './render';

/** `2026-09-24T07:00:00.500Z` → `triage-2026-09-24T07-00-00`; milliseconds are dropped from the name. */
function baseNameFor(generatedAt: string): string {
  return `triage-${generatedAt.replace(/\.\d+Z?$/, '').replace(/Z$/, '').replace(/[:.]/g, '-')}`;
}

/** Writes the report as Markdown for people and as JSON for tools, side by side. */
export class MarkdownNotifier implements Notifier {
  constructor(private readonly outDir: string) {}

  async send(report: TriageReport): Promise<void> {
    fs.mkdirSync(this.outDir, { recursive: true });
    // Two reports within the same second get -2, -3…: a report is never overwritten.
    let base = baseNameFor(report.generatedAt);
    for (let n = 2; fs.existsSync(path.join(this.outDir, `${base}.json`)); n++) {
      base = `${baseNameFor(report.generatedAt)}-${n}`;
    }
    fs.writeFileSync(path.join(this.outDir, `${base}.md`), renderMarkdown(report));
    fs.writeFileSync(path.join(this.outDir, `${base}.json`), JSON.stringify(report, null, 2) + '\n');
  }
}

/** The JSON twins of every report in `outDir`, ascending by name. */
export function readReports(outDir: string): TriageReport[] {
  if (!fs.existsSync(outDir)) return [];
  return fs.readdirSync(outDir)
    .filter((f) => /^triage-.*\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')) as TriageReport);
}

export interface MarkdownNotifierConfig {
  outDir: string;
}

const configSchema: ConfigSchema<MarkdownNotifierConfig> = {
  parse(input: unknown): MarkdownNotifierConfig {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('markdown config must be an object');
    const { outDir } = input as Record<string, unknown>;
    if (typeof outDir !== 'string' || outDir.length === 0) throw new Error('markdown config needs a non-empty "outDir"');
    return { outDir };
  },
};

export const markdownNotifierPlugin: TriagePlugin<'notifier', MarkdownNotifierConfig> = {
  name: 'markdown',
  kind: 'notifier',
  configSchema,
  create: (config) => new MarkdownNotifier(config.outDir),
};

export { renderMarkdown } from './render';
