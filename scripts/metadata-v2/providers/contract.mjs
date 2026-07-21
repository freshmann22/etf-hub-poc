export const PROBE_STATUS = Object.freeze({
  OK: 'ok',
  PARTIAL: 'partial',
  EMPTY: 'empty',
  FAILED: 'failed',
  NOT_RUN: 'not_run',
  BLOCKED_PENDING_TERMS: 'blocked_pending_terms',
});

export const EXECUTION_POLICY = Object.freeze({
  NETWORK_OPT_IN: 'network_opt_in',
  BLOCKED_PENDING_TERMS: 'blocked_pending_terms',
});

export const FIELD_KEYS = Object.freeze([
  'identity',
  'benchmark',
  'descriptions',
  'holdings',
  'sectorWeights',
  'countryWeights',
  'distributionPolicy',
  'distributionHistory',
  'fees',
  'listingDate',
]);

export function emptyFieldSupport() {
  return Object.fromEntries(FIELD_KEYS.map((field) => [field, false]));
}

export function validateProbeConfig(config) {
  if (!config || !Array.isArray(config.sources) || !Array.isArray(config.canaries)) {
    throw new Error('probe config requires sources and canaries arrays');
  }
  const sourceIds = new Set();
  for (const source of config.sources) {
    if (!source.sourceId || sourceIds.has(source.sourceId)) throw new Error(`invalid or duplicate sourceId: ${source.sourceId}`);
    if (!Object.values(EXECUTION_POLICY).includes(source.executionPolicy)) {
      throw new Error(`unsupported executionPolicy for ${source.sourceId}`);
    }
    sourceIds.add(source.sourceId);
  }
  if (config.canaries.length < 20 || config.canaries.length > 30) {
    throw new Error(`canary count must be between 20 and 30; got ${config.canaries.length}`);
  }
  for (const canary of config.canaries) {
    if (!sourceIds.has(canary.sourceId)) throw new Error(`unknown canary sourceId: ${canary.sourceId}`);
    if (!/^[0-9A-Z]{6}$/.test(canary.etfCode)) throw new Error(`invalid ETF short code: ${canary.etfCode}`);
    if (!Array.isArray(canary.strata) || canary.strata.length === 0) throw new Error(`missing strata: ${canary.etfCode}`);
  }
  return config;
}

export function makeProbeResult({ source, canary, status, fields, diagnostics = {}, error = null, startedAt, finishedAt }) {
  return {
    sourceId: source.sourceId,
    issuer: source.issuer,
    etfCode: canary.etfCode,
    name: canary.name,
    strata: [...canary.strata],
    status,
    fields: { ...emptyFieldSupport(), ...(fields || {}) },
    rowCount: Number.isInteger(diagnostics.rowCount) ? diagnostics.rowCount : 0,
    asOfDate: diagnostics.asOfDate || null,
    upstreamStatus: diagnostics.upstreamStatus || null,
    sourceUrl: source.officialUrl,
    executionPolicy: source.executionPolicy,
    termsStatus: source.termsStatus,
    startedAt: startedAt || null,
    finishedAt: finishedAt || null,
    error: error ? String(error.message || error) : null,
  };
}

export class MetadataProbeProvider {
  constructor(source) {
    this.source = source;
  }

  async probe(_canary, _context = {}) {
    throw new Error(`probe not implemented for ${this.source.sourceId}`);
  }
}
