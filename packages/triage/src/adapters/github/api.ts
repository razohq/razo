export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; redirect?: 'follow' },
) => Promise<FetchResponseLike>;

export class GitHubApiError extends Error {
  constructor(readonly status: number, readonly path: string, detail: string) {
    super(`GitHub API ${status} on ${path}${detail ? `: ${detail}` : ''}`);
    this.name = 'GitHubApiError';
  }
}

export interface GitHubApiOptions {
  token: string;
  /** Defaults to the global fetch. Tests inject a replayer. */
  fetch?: FetchLike;
  baseUrl?: string;
}

/** The thin HTTP layer under the github adapter and the artifacts collector. */
export class GitHubApi {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options: GitHubApiOptions) {
    // GitHub Actions hands a missing secret over as an empty string; refuse it here, not with a 401 later.
    if (!options.token) throw new Error('GitHub token is empty');
    this.token = options.token;
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'razo-triage',
    };
  }

  private async request(path: string): Promise<FetchResponseLike> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { headers: this.headers(), redirect: 'follow' });
    if (!response.ok) {
      let detail = '';
      try {
        detail = String(((await response.json()) as { message?: string })?.message ?? '');
      } catch {
        // not JSON: the status is the whole story
      }
      throw new GitHubApiError(response.status, path, detail);
    }
    return response;
  }

  async getJson<T>(path: string): Promise<T> {
    return (await this.request(path)).json() as Promise<T>;
  }

  /** Follows `page=N` until a page comes back shorter than `perPage`. */
  async getAll<T>(path: string, pick: (page: unknown) => T[], perPage = 100): Promise<T[]> {
    const all: T[] = [];
    const joiner = path.includes('?') ? '&' : '?';
    for (let page = 1; ; page++) {
      const items = pick(await this.getJson<unknown>(`${path}${joiner}per_page=${perPage}&page=${page}`));
      all.push(...items);
      if (items.length < perPage) return all;
    }
  }

  async getBinary(path: string): Promise<Buffer> {
    return Buffer.from(await (await this.request(path)).arrayBuffer());
  }
}
