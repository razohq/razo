import type { TriageReport } from '../../core/model';
import type { Notifier } from '../../ports/notifier';
import type { ConfigSchema, TriagePlugin } from '../../ports/plugin';
import { prepareReportForUpload } from './limits';

export interface HttpNotifierConfig {
  /** The destination's endpoint, e.g. https://razo.ar/api/triage/reports. Any implementer of the delivery contract works. */
  url: string;
  /** Bearer token the destination issued; for razo-cloud, the project's ingest token. */
  token: string;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type PostLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<ResponseLike>;

/**
 * Delivers the morning over HTTP to any destination that implements the
 * report delivery contract (DESIGN.md): POST the TriageReport as JSON with a
 * bearer token. razo-cloud is the first implementer; qano-cloud or another
 * server is a different url, not a different plugin. Destinations upsert by
 * project and generatedAt, so a retried morning never duplicates a report.
 */
export class HttpNotifier implements Notifier {
  constructor(
    private readonly config: HttpNotifierConfig,
    private readonly post: PostLike = (url, init) => globalThis.fetch(url, init) as Promise<ResponseLike>,
  ) {}

  async send(report: TriageReport): Promise<void> {
    const { report: payload } = prepareReportForUpload(report);
    const response = await this.post(this.config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`${this.config.url} rejected the triage report: ${response.status} ${body.slice(0, 300)}`);
    }
  }
}

const configSchema: ConfigSchema<HttpNotifierConfig> = {
  parse(input: unknown): HttpNotifierConfig {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('http notifier config must be an object');
    const { url, token } = input as Record<string, unknown>;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('http notifier config needs an http(s) "url"');
    if (typeof token !== 'string' || token.length === 0) throw new Error('http notifier config needs a non-empty "token"');
    return { url, token };
  },
};

export const httpNotifierPlugin: TriagePlugin<'notifier', HttpNotifierConfig> = {
  name: 'http',
  kind: 'notifier',
  configSchema,
  create: (config) => new HttpNotifier(config),
};

export {
  prepareReportForUpload,
  MAX_CLUSTERS_PER_REPORT, MAX_FAILURES_PER_CLUSTER, MAX_EVIDENCE_PER_VERDICT, MAX_SUSPECTS_PER_CLUSTER,
  MAX_TEXT_CHARS, MAX_SIGNATURE_CHARS, MAX_UPLOAD_BYTES,
} from './limits';
