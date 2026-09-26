import type { ConfigSchema, TriagePlugin } from '../../ports/plugin';
import { GitHubApi } from './api';
import { GitHubCodeContext } from './code-context';

export interface GitHubConfig {
  /** owner/name */
  repo: string;
  /** Fine-grained token with contents:read (and actions:read for the collector). */
  token: string;
}

export const githubConfigSchema: ConfigSchema<GitHubConfig> = {
  parse(input: unknown): GitHubConfig {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('github config must be an object');
    const { repo, token } = input as Record<string, unknown>;
    if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('github config needs "repo" as owner/name');
    if (typeof token !== 'string' || token.length === 0) throw new Error('github config needs a non-empty "token"');
    return { repo, token };
  },
};

export const githubCodePlugin: TriagePlugin<'code', GitHubConfig> = {
  name: 'github',
  kind: 'code',
  configSchema: githubConfigSchema,
  create: (config) => new GitHubCodeContext(new GitHubApi({ token: config.token }), config.repo),
};

export { GitHubApi, GitHubApiError, type FetchLike, type FetchResponseLike, type GitHubApiOptions } from './api';
export { GitHubCodeContext } from './code-context';
