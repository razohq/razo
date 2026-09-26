import type { TriageReport } from '../core/model';
import type { Notifier } from '../ports/notifier';

/** In-memory Notifier: keeps every report it was asked to send. */
export class MemoryNotifier implements Notifier {
  readonly sent: TriageReport[] = [];

  async send(report: TriageReport): Promise<void> {
    this.sent.push(structuredClone(report));
  }
}
