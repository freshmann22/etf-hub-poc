import { createHash } from 'node:crypto';

const SOURCE_TYPES = new Set(['primary', 'secondary', 'derived']);
const STATUSES = new Set(['ok', 'partial', 'stale', 'unavailable']);

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash('sha256').update(bytes).digest('hex');
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function makeProvenance(input, { now = () => new Date() } = {}) {
  const provenance = {
    sourceId: String(input?.sourceId || '').trim(),
    sourceType: input?.sourceType || 'secondary',
    url: input?.url ?? null,
    documentType: input?.documentType ?? null,
    retrievedAt: input?.retrievedAt || now().toISOString(),
    asOfDate: input?.asOfDate ?? null,
    rawSnapshotPath: input?.rawSnapshotPath ?? null,
    contentHash: input?.contentHash ?? null,
    parserVersion: String(input?.parserVersion || '').trim(),
    status: input?.status || 'ok',
    confidence: input?.confidence ?? 1,
  };
  validateProvenance(provenance);
  return Object.freeze(provenance);
}

export function validateProvenance(value) {
  if (!value?.sourceId) throw new Error('provenance.sourceId is required');
  if (!SOURCE_TYPES.has(value.sourceType)) throw new Error(`invalid provenance.sourceType: ${value.sourceType}`);
  if (!STATUSES.has(value.status)) throw new Error(`invalid provenance.status: ${value.status}`);
  if (!value.parserVersion) throw new Error('provenance.parserVersion is required');
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error('provenance.confidence must be between 0 and 1');
  }
  if (Number.isNaN(Date.parse(value.retrievedAt))) throw new Error('provenance.retrievedAt must be an ISO date-time');
  if (value.contentHash != null && !/^[a-f0-9]{64}$/.test(value.contentHash)) {
    throw new Error('provenance.contentHash must be a lowercase SHA-256 hash');
  }
  return true;
}

export function makeFieldCandidate({ field, value, provenance, evidence = null }) {
  if (!String(field || '').trim()) throw new Error('candidate.field is required');
  validateProvenance(provenance);
  const fingerprint = stableStringify(evidence == null ? { field, value, provenance } : { field, value, provenance, evidence });
  const candidate = {
    candidateId: sha256(fingerprint),
    field,
    value,
    provenance,
  };
  if (evidence != null) candidate.evidence = evidence;
  return Object.freeze(candidate);
}
