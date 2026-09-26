import * as fs from 'fs';
import * as path from 'path';
import { unzipSync } from 'fflate';
import type { GitHubApi } from '../adapters/github/api';
import { STATE_SCHEMA_VERSION } from '../adapters/json-store';

/** The artifact the workflow uploads after `triage run` and `triage pull` restores before the next one. */
export const STATE_ARTIFACT_NAME = 'razo-triage-state';
/** The entry inside that artifact. */
export const STATE_FILE_NAME = 'triage-state.json';

interface Artifact {
  id: number;
  name: string;
  expired: boolean;
  created_at: string;
}

export interface RestoreOptions {
  api: GitHubApi;
  /** owner/name */
  repo: string;
  /** Where the JSON file store lives locally. */
  file: string;
  artifactName?: string;
}

export type RestoreResult =
  | { restored: true; artifactId: number; createdAt: string }
  | { restored: false };

/**
 * Downloads the most recent non-expired state artifact into the store file.
 * The artifact is refused, and the local file kept, when it carries no
 * state entry or a state of another schema version.
 */
export async function restoreState(options: RestoreOptions): Promise<RestoreResult> {
  const name = options.artifactName ?? STATE_ARTIFACT_NAME;
  const artifacts = await options.api.getAll<Artifact>(
    `/repos/${options.repo}/actions/artifacts?name=${encodeURIComponent(name)}`,
    (page) => (page as { artifacts: Artifact[] }).artifacts,
  );
  const latest = artifacts
    .filter((a) => a.name === name && !a.expired)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!latest) return { restored: false };

  const zip = await options.api.getBinary(`/repos/${options.repo}/actions/artifacts/${latest.id}/zip`);
  const entries = unzipSync(new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength), {
    filter: (f) => path.basename(f.name) === STATE_FILE_NAME,
  });
  const entry = Object.values(entries)[0];
  if (!entry) throw new Error(`artifact ${name} #${latest.id} has no ${STATE_FILE_NAME} entry`);
  const text = Buffer.from(entry).toString('utf8');
  let parsed: { schemaVersion?: unknown };
  try {
    parsed = JSON.parse(text) as { schemaVersion?: unknown };
  } catch (error) {
    throw new Error(`artifact ${name} #${latest.id}: ${STATE_FILE_NAME} is not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (parsed?.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(
      `artifact ${name} #${latest.id}: unknown triage state schema version ${JSON.stringify(parsed?.schemaVersion)} (this build reads version ${STATE_SCHEMA_VERSION})`,
    );
  }
  fs.mkdirSync(path.dirname(options.file), { recursive: true });
  const tmp = `${options.file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, options.file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  return { restored: true, artifactId: latest.id, createdAt: latest.created_at };
}
