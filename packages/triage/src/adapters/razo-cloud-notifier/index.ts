import type { TriageReport } from '../../core/model';
import type { Notifier } from '../../ports/notifier';
import type { ConfigSchema, TriagePlugin } from '../../ports/plugin';
import { prepareReportForUpload } from './limits';

export interface RazoCloudNotifierConfig {
  /** razo-cloud base URL, e.g. https://razo.ar */
  url: string;
  /** The project's ingest token (rz_…), the same one razo-upload uses. */
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
 * Delivers the morning to razo-cloud: POST /api/triage/reports with the
 * report as JSON. The server upserts by project and generatedAt, so a
 * retried morning never duplicates a report.
 */
export class RazoCloudNotifier implements Notifier {
  private readonly endpoint: string;

  constructor(
    private readonly config: RazoCloudNotifierConfig,
    private readonly post: PostLike = (url, init) => globalThis.fetch(url, init) as Promise<ResponseLike>,
  ) {
    this.endpoint = `${config.url.replace(/\/+$/, '')}/api/triage/reports`;
  }

  async send(report: TriageReport): Promise<void> {
    const { report: payload } = prepareReportForUpload(report);
    const response = await this.post(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`razo-cloud rejected the triage report: ${response.status} ${body.slice(0, 300)}`);
    }
  }
}

const configSchema: ConfigSchema<RazoCloudNotifierConfig> = {
  parse(input: unknown): RazoCloudNotifierConfig {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('razo-cloud config must be an object');
    const { url, token } = input as Record<string, unknown>;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('razo-cloud config needs an http(s) "url"');
    if (typeof token !== 'string' || token.length === 0) throw new Error('razo-cloud config needs a non-empty "token"');
    return { url, token };
  },
};

export const razoCloudNotifierPlugin: TriagePlugin<'notifier', RazoCloudNotifierConfig> = {
  name: 'razo-cloud',
  kind: 'notifier',
  configSchema,
  create: (config) => new RazoCloudNotifier(config),
};

export {
  prepareReportForUpload,
  MAX_CLUSTERS_PER_REPORT, MAX_FAILURES_PER_CLUSTER, MAX_EVIDENCE_PER_VERDICT, MAX_SUSPECTS_PER_CLUSTER,
  MAX_TEXT_CHARS, MAX_SIGNATURE_CHARS, MAX_UPLOAD_BYTES,
} from './limits';
