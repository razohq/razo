import type { TriageReport } from '../../core/model';

/**
 * Caps of the report delivery contract (DESIGN.md, "Report delivery
 * contract"). A destination may reject an oversized report whole, so the
 * notifier trims below these numbers; the Markdown report on disk stays
 * complete.
 */
export const MAX_CLUSTERS_PER_REPORT = 200;
export const MAX_FAILURES_PER_CLUSTER = 500;
export const MAX_EVIDENCE_PER_VERDICT = 50;
export const MAX_SUSPECTS_PER_CLUSTER = 10;
export const MAX_TEXT_CHARS = 2_048;
export const MAX_SIGNATURE_CHARS = 1_024;
export const MAX_UPLOAD_BYTES = 2_000_000;

const SUFFIX = '… [truncated]';
const cut = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max - SUFFIX.length) + SUFFIX);

function trimItem(item: TriageReport['items'][number]): TriageReport['items'][number] {
  const { cluster, verdict, proposedActions } = item;
  return {
    cluster: {
      ...cluster,
      signature: cut(cluster.signature, MAX_SIGNATURE_CHARS),
      // The most recent failures are the ones a person acts on.
      failures: cluster.failures.slice(-MAX_FAILURES_PER_CLUSTER),
      suspectCommits: cluster.suspectCommits.slice(0, MAX_SUSPECTS_PER_CLUSTER).map((s) => ({ ...s, message: cut(s.message, MAX_TEXT_CHARS) })),
    },
    verdict: {
      ...verdict,
      summary: cut(verdict.summary, MAX_TEXT_CHARS),
      nextStep: cut(verdict.nextStep, MAX_TEXT_CHARS),
      ...(verdict.disagreement ? { disagreement: cut(verdict.disagreement, MAX_TEXT_CHARS) } : {}),
      evidence: verdict.evidence.slice(0, MAX_EVIDENCE_PER_VERDICT).map((e) => ({ ...e, description: cut(e.description, MAX_TEXT_CHARS) })),
    },
    proposedActions: proposedActions.map((a) =>
      a.type === 'create-issue'
        ? { ...a, draft: { ...a.draft, title: cut(a.draft.title, MAX_TEXT_CHARS), body: cut(a.draft.body, MAX_TEXT_CHARS * 4) } }
        : a.type === 'comment-issue' ? { ...a, body: cut(a.body, MAX_TEXT_CHARS * 4) } : a,
    ),
  };
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/**
 * Trims every oversized field and list, then fits the byte budget: the
 * heaviest cluster loses half its oldest failures, repeatedly, and only
 * when no cluster can shrink any further does the report drop clusters
 * from the end, which the report ranks lowest. `trimmed` says whether
 * anything changed.
 */
export function prepareReportForUpload(report: TriageReport): { report: TriageReport; trimmed: boolean } {
  const items = report.items.slice(0, MAX_CLUSTERS_PER_REPORT).map(trimItem);
  const budget = MAX_UPLOAD_BYTES - 1_000; // headroom for the report's own framing
  while (bytes({ ...report, items }) > budget) {
    const heaviest = items.reduce((a, b) => (bytes(a) >= bytes(b) ? a : b));
    const n = heaviest.cluster.failures.length;
    if (n > 1) {
      heaviest.cluster = { ...heaviest.cluster, failures: heaviest.cluster.failures.slice(-Math.floor(n / 2)) };
    } else if (items.length > 1) {
      items.pop();
    } else {
      throw new Error(`one triage cluster is ${bytes(heaviest)} bytes on its own; the delivery contract allows up to ${MAX_UPLOAD_BYTES} per report`);
    }
  }
  const out: TriageReport = { ...report, items };
  return JSON.stringify(report) === JSON.stringify(out) ? { report, trimmed: false } : { report: out, trimmed: true };
}
