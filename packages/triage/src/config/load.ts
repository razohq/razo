import * as fs from 'fs';
import { load } from 'js-yaml';
import { parseConfig, type TriageConfig } from './schema';

export function loadConfig(file: string, env: Record<string, string | undefined> = process.env): TriageConfig {
  if (!fs.existsSync(file)) throw new Error(`config not found: ${file}`);
  return parseConfig(load(fs.readFileSync(file, 'utf8')), env);
}
