import type { TriageReport } from '../core/model';

/** Delivers the finished report. Contract: `send` resolves and may be called repeatedly. */
export interface Notifier {
  send(report: TriageReport): Promise<void>;
}
