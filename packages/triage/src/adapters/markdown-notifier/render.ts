import type { ProposedAction, TriageReport } from '../../core/model';

const short = (sha: string) => sha.slice(0, 7);

/** States that go to the compact "Known" section instead of the main list. */
const COMPACT = new Set(['ignored', 'flaky']);

function daysOpen(firstSeenAt: string, generatedAt: string): number {
  return Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(firstSeenAt)) / 86_400_000));
}

/** Inline code that survives backticks in the text: a fence one longer than the longest run inside, padded when the text touches the edge. */
function code(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function actionLine(action: ProposedAction): string {
  switch (action.type) {
    case 'create-issue': return `create-issue: ${action.draft.title}`;
    case 'comment-issue': return `comment-issue on ${action.issue.key}: ${action.body}`;
    default: return action.type;
  }
}

/** The report as a person reads it in the morning: totals first, then one section per cluster. */
export function renderMarkdown(report: TriageReport): string {
  const lines: string[] = [
    `# Triage ${report.generatedAt.slice(0, 10)}`,
    '',
    `Window: ${report.window.from} → ${report.window.to}`,
    '',
    `${plural(report.totals.tests, 'test')} · ${plural(report.totals.failures, 'failure')} · ${plural(report.totals.clusters, 'cluster')}`,
    '',
  ];
  if (report.items.length === 0) {
    lines.push('No failures in this window.', '');
    return lines.join('\n');
  }
  // Reopened clusters first: a fix that stopped working outranks anything else this morning.
  const main = report.items
    .filter((i) => !COMPACT.has(i.cluster.state))
    .sort((a, b) => Number(b.cluster.novelty === 'reopened') - Number(a.cluster.novelty === 'reopened'));
  const known = report.items.filter((i) => COMPACT.has(i.cluster.state));
  const reopened = main.filter((i) => i.cluster.novelty === 'reopened').length;
  if (reopened > 0) lines.push(`**${reopened} reopened**: resolved before, failing again.`, '');
  if (main.length === 0) lines.push('Nothing new: every failure in this window is a known ignored or flaky cluster.', '');
  for (const { cluster, verdict, proposedActions } of main) {
    const days = daysOpen(cluster.firstSeenAt, report.generatedAt);
    lines.push(
      `## ${cluster.novelty === 'reopened' ? '⚠ reopened · ' : ''}${verdict.category} · ${verdict.confidence}`, '',
      `${cluster.novelty} · open for ${days} day${days === 1 ? '' : 's'} · state ${cluster.state}`, '',
      code(cluster.signature), '', verdict.summary, '', `**Next:** ${verdict.nextStep}`, '',
    );
    lines.push('Tests:', ...[...new Set(cluster.failures.map((f) => f.testId))].map((t) => `- ${t}`), '');
    if (cluster.lastGreenSha && cluster.firstRedSha) {
      lines.push(`Range: ${short(cluster.lastGreenSha)}..${short(cluster.firstRedSha)}`, '');
    }
    if (cluster.suspectCommits.length > 0) {
      lines.push('Suspects:', ...cluster.suspectCommits.map((s) => `- ${short(s.sha)} ${s.message} — ${s.overlappingComponents.join(', ')} (${s.author})`), '');
    }
    lines.push('Evidence:', ...verdict.evidence.map((e) => `- [${e.kind}] ${e.description}`), '');
    if (proposedActions.length > 0) lines.push('Proposed actions:', ...proposedActions.map((a) => `- ${actionLine(a)}`), '');
  }
  if (known.length > 0) {
    lines.push('## Known', '', 'Failures a person already ignored or marked flaky; listed, not triaged again.', '');
    for (const { cluster, verdict } of known) {
      const tests = [...new Set(cluster.failures.map((f) => f.testId))];
      lines.push(`- (${cluster.state}) ${code(cluster.signature)} — ${verdict.category}, ${tests.length} test${tests.length === 1 ? '' : 's'}, open for ${daysOpen(cluster.firstSeenAt, report.generatedAt)} days`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
