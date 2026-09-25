import type { ProposedAction, TriageReport } from '../../core/model';

const short = (sha: string) => sha.slice(0, 7);
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
  for (const { cluster, verdict, proposedActions } of report.items) {
    lines.push(`## ${verdict.category} · ${verdict.confidence}`, '', `\`${cluster.signature}\``, '', verdict.summary, '', `**Next:** ${verdict.nextStep}`, '');
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
  return lines.join('\n');
}
