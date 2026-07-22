import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFieldCandidate, makeProvenance } from './lib/provenance.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_PATHS = Object.freeze({
  identity: resolve(ROOT, 'data/normalized/etf-identity-map-v2.json'),
  issuerInventory: resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'),
  legacy: resolve(ROOT, 'data/normalized/etf-metadata.json'),
  output: resolve(ROOT, 'data/normalized/etf-metadata-v2.json'),
});

const OFFICIAL_STATUS_OVERRIDES = Object.freeze({
  '424460': {
    listingStatus: 'delisted',
    asOfDate: '2026-07-20',
    sourceId: 'kind',
    url: 'https://kind.krx.co.kr/external/2026/06/16/000415/20260616000922/68616.htm',
    documentType: 'etf_delisting_notice',
    parserVersion: 'kind-manual-verification-1.0.0',
    confidence: 0.99,
  },
});

function asDate(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function compact(values) {
  return [...new Set(values.filter((value) => value != null && value !== ''))];
}

function toStringArray(value) {
  if (Array.isArray(value)) return compact(value.map(String));
  return value == null || value === '' ? [] : [String(value)];
}

function groupCandidates(candidates) {
  const grouped = {};
  for (const candidate of candidates || []) {
    if (!candidate?.field || !candidate?.provenance) continue;
    (grouped[candidate.field] ||= []).push(candidate);
  }
  return grouped;
}

function addCandidate(grouped, candidate) {
  (grouped[candidate.field] ||= []).push(candidate);
}

function legacyCandidate(field, value, legacy, now) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return makeFieldCandidate({
    field,
    value,
    provenance: makeProvenance({
      sourceId: 'legacy_v1',
      sourceType: 'secondary',
      url: null,
      documentType: 'normalized_etf_metadata_v1',
      retrievedAt: legacy.updatedAt || now,
      asOfDate: field.startsWith('portfolio.') ? legacy.holdingsAsOfDate ?? null : null,
      rawSnapshotPath: null,
      contentHash: null,
      parserVersion: 'legacy-v1-import-1.0.0',
      status: 'partial',
      confidence: 0.6,
    }),
  });
}

function inventoryCandidate(field, value, row, inventory, now) {
  if (value == null || value === '') return null;
  const locallyConfirmed = row.issuer?.needsOfficialVerification === false;
  return makeFieldCandidate({
    field,
    value,
    provenance: makeProvenance({
      sourceId: 'issuer_inventory',
      sourceType: 'derived',
      documentType: 'brand_to_issuer_inventory',
      retrievedAt: inventory.generatedAt || now,
      parserVersion: inventory.schemaVersion || '1.0.0',
      status: locallyConfirmed ? 'ok' : 'partial',
      confidence: locallyConfirmed ? 0.8 : 0.65,
    }),
  });
}

function officialStatusCandidate(field, value, override, now) {
  return makeFieldCandidate({
    field,
    value,
    provenance: makeProvenance({
      sourceId: override.sourceId,
      sourceType: 'primary',
      url: override.url,
      documentType: override.documentType,
      retrievedAt: now,
      asOfDate: override.asOfDate,
      rawSnapshotPath: null,
      contentHash: null,
      parserVersion: override.parserVersion,
      status: 'ok',
      confidence: override.confidence,
    }),
  });
}

function legacyMasterCandidate(field, value, identityMap, now) {
  if (value == null || value === '') return null;
  return makeFieldCandidate({
    field,
    value,
    provenance: makeProvenance({
      sourceId: 'naver_master',
      sourceType: 'secondary',
      url: 'https://finance.naver.com/api/sise/etfItemList.nhn',
      documentType: 'legacy_universe_master',
      retrievedAt: identityMap.universeAsOfDate || identityMap.generatedAt || now,
      rawSnapshotPath: null,
      contentHash: null,
      parserVersion: 'legacy-master-import-1.0.0',
      status: 'partial',
      confidence: 0.7,
    }),
  });
}

function mapHoldings(legacy) {
  return (legacy?.holdings || []).filter((holding) => holding?.name).map((holding) => ({
    shortCode: holding.code ?? holding.stockCode ?? null,
    isin: holding.isin ?? null,
    ticker: holding.ticker ?? null,
    name: holding.name,
    instrumentType: holding.instrumentType ?? null,
    weight: Number.isFinite(holding.weight) ? holding.weight : null,
  }));
}

function mapWeights(values) {
  return (values || []).map((item) => ({
    key: item.key ?? item.code ?? null,
    label: item.label ?? item.name ?? String(item.key ?? item.code ?? 'unknown'),
    weight: Number(item.weight),
  })).filter((item) => Number.isFinite(item.weight));
}

export function assembleV2({ identityMap, issuerInventory, legacyMetadata, now = new Date().toISOString() }) {
  if (!Array.isArray(identityMap?.records)) throw new Error('identityMap.records is required');
  const legacyByCode = new Map((legacyMetadata?.records || []).map((record) => [record.etfCode, record]));
  const inventoryByCode = new Map((issuerInventory?.rows || []).map((row) => [row.sourceRecord?.etfCode, row]));

  const records = identityMap.records.map((identityRecord) => {
    const key = identityRecord.universeKey;
    const legacy = legacyByCode.get(key) || null;
    const inventoryRow = inventoryByCode.get(key) || null;
    const officialOverride = OFFICIAL_STATUS_OVERRIDES[key] || null;
    const candidates = groupCandidates(identityRecord.fieldCandidates);
    const addLegacy = (field, value) => {
      const candidate = legacyCandidate(field, value, legacy || {}, now);
      if (candidate) addCandidate(candidates, candidate);
    };
    const addInventory = (field, value) => {
      const candidate = inventoryCandidate(field, value, inventoryRow, issuerInventory || {}, now);
      if (candidate) addCandidate(candidates, candidate);
    };

    if (legacy) {
      addLegacy('identity.issuerName', legacy.issuer);
      addLegacy('identity.listingDate', asDate(legacy.listingDate));
      addLegacy('product.description', legacy.descriptions?.productDescription);
      addLegacy('product.investmentObjective', legacy.descriptions?.investmentObjective);
      addLegacy('product.benchmark.name', legacy.benchmark?.name);
      addLegacy('product.benchmark.provider', legacy.benchmark?.provider);
      addLegacy('product.benchmark.description', legacy.benchmark?.description ?? legacy.descriptions?.benchmarkDescription);
      addLegacy('product.assetClasses', toStringArray(legacy.classificationFacts?.assetClass));
      addLegacy('product.targetRegions', toStringArray(legacy.classificationFacts?.regions));
      addLegacy('product.active', legacy.classificationFacts?.active);
      addLegacy('product.currencyHedged', legacy.classificationFacts?.currencyHedged);
      addLegacy('portfolio.holdings', mapHoldings(legacy));
      addLegacy('portfolio.sectorWeights', mapWeights(legacy.sectorWeights));
      addLegacy('portfolio.countryWeights', mapWeights(legacy.countryWeights));
      addLegacy('distribution.schedule', legacy.distribution?.scheduleText);
      addLegacy('distribution.frequency', legacy.distribution?.frequency);
    }
    if (inventoryRow?.issuer) {
      addInventory('identity.issuerId', inventoryRow.issuer.id);
      addInventory('identity.issuerName', inventoryRow.issuer.displayNameKo);
    }
    if (!officialOverride && ['listed', 'delisted', 'pending'].includes(identityRecord.sourceRecord?.status)) {
      addCandidate(candidates, legacyMasterCandidate('identity.listingStatus', identityRecord.sourceRecord.status, identityMap, now));
    }
    if (officialOverride) {
      addCandidate(candidates, officialStatusCandidate('identity.listingStatus', officialOverride.listingStatus, officialOverride, now));
    }

    const identity = identityRecord.identity || {};
    const source = identityRecord.sourceRecord || {};
    const holdings = mapHoldings(legacy);
    const sectorWeights = mapWeights(legacy?.sectorWeights);
    const countryWeights = mapWeights(legacy?.countryWeights);
    const schedule = legacy?.distribution?.scheduleText ?? null;
    const frequency = legacy?.distribution?.frequency ?? null;
    const issuerId = inventoryRow?.issuer?.id ?? identity.issuerId ?? null;
    const issuerName = inventoryRow?.issuer?.displayNameKo ?? identity.issuerName ?? legacy?.issuer ?? null;

    return {
      universeKey: key,
      identity: {
        shortCode: identity.shortCode ?? null,
        isin: identity.isin ?? null,
        officialName: identity.officialName ?? source.name ?? null,
        aliases: compact([source.name, legacy?.name].filter((name) => name !== identity.officialName)),
        issuerId,
        issuerName,
        listingDate: asDate(legacy?.listingDate ?? source.listingDate),
        listingStatus: officialOverride?.listingStatus
          ?? (['listed', 'delisted', 'pending'].includes(source.status) ? source.status : 'unknown'),
      },
      product: {
        description: legacy?.descriptions?.productDescription ?? null,
        investmentObjective: legacy?.descriptions?.investmentObjective ?? null,
        benchmark: {
          name: identityRecord.benchmarkName ?? legacy?.benchmark?.name ?? null,
          provider: legacy?.benchmark?.provider ?? null,
          indexCode: null,
          description: legacy?.benchmark?.description ?? legacy?.descriptions?.benchmarkDescription ?? null,
        },
        assetClasses: toStringArray(legacy?.classificationFacts?.assetClass),
        targetRegions: toStringArray(legacy?.classificationFacts?.regions),
        active: legacy?.classificationFacts?.active ?? null,
        replication: null,
        derivative: { direction: null, multiple: null },
        currencyHedged: legacy?.classificationFacts?.currencyHedged ?? null,
        fundOfFunds: null,
      },
      portfolio: {
        asOfDate: asDate(legacy?.holdingsAsOfDate),
        holdings,
        sectorWeights,
        countryWeights,
      },
      distribution: {
        applicability: schedule || frequency ? 'applicable' : 'unknown',
        schedule,
        frequency,
        history: [],
      },
      fieldCandidates: candidates,
      conflicts: [],
      status: officialOverride
        ? 'partial'
        : identityRecord.status === 'quarantined'
        ? 'quarantined'
        : legacy || identityRecord.status === 'resolved' ? 'partial' : 'unavailable',
    };
  });

  if (records.length !== identityMap.universeCount) {
    throw new Error(`universe shape mismatch: expected ${identityMap.universeCount}, assembled ${records.length}`);
  }
  if (new Set(records.map((record) => record.universeKey)).size !== records.length) {
    throw new Error('duplicate universeKey in assembled records');
  }
  return { schemaVersion: '2.0.0', generatedAt: now, universeCount: identityMap.universeCount, records };
}

export function runAssembler(paths = DEFAULT_PATHS) {
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const output = assembleV2({
    identityMap: read(paths.identity),
    issuerInventory: read(paths.issuerInventory),
    legacyMetadata: read(paths.legacy),
  });
  mkdirSync(dirname(paths.output), { recursive: true });
  writeFileSync(paths.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const output = runAssembler();
  console.log(`[metadata-v2:assemble] ${output.records.length} records -> ${DEFAULT_PATHS.output}`);
}
