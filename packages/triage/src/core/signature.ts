import { createHash } from 'crypto';

/**
 * Bump whenever errorSignature changes what it collapses: signatures, and
 * therefore cluster ids, stop matching the ones a previous state recorded.
 */
export const SIGNATURE_ALGORITHM_VERSION = 1;

/**
 * Normalizes an error message into the key failures are clustered by.
 *
 * Lives in the core, not in adapters, so every ResultSource produces the same
 * signature for the same failure and clusters can cross sources. The contract
 * kit enforces that adapters call this rather than rolling their own.
 *
 * Only machine-generated noise is collapsed: timestamps, UUIDs, long hex or
 * numeric ids, and ports. Everything a human wrote or asserted on stays,
 * because two failures that differ in a control name, a quoted value or an
 * assertion number are two different failures. Collapsing them would merge
 * causes and hand the triage a cluster nobody can act on.
 */
export function errorSignature(message: string | null | undefined): string {
  const firstLine = (message ?? '').split('\n')[0].trim();
  if (!firstLine) return 'unknown error';
  return firstLine
    .toLowerCase()
    .replace(ISO_TIMESTAMP, '<ts>')
    .replace(UUID, '<uuid>')
    .replace(LONG_HEX_ID, '<hex>')
    .replace(LONG_NUMERIC_ID, '<id>')
    .replace(HOST_PORT, '$1:<port>');
}

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:z|[+-]\d{2}:?\d{2})?/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
/** 8+ hex chars containing both a digit and a letter: a git sha, a build hash. */
const LONG_HEX_ID = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/g;
/** 8+ digits: an order number, a record id. Shorter runs are assertion values. */
const LONG_NUMERIC_ID = /\b\d{8,}\b/g;
/** A port only counts as one when it follows a host: localhost, an IPv4 or a dotted name. */
const HOST_PORT = /\b(localhost|\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9-]+(?:\.[a-z0-9-]+)+):\d{2,5}\b/g;

/** Cluster ids are derived from the signature, never assigned: same failure, same cluster. */
export function clusterIdOf(signature: string): string {
  return createHash('sha1').update(signature).digest('hex').slice(0, 12);
}
