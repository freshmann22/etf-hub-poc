import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULTS = {
  master: resolve(ROOT, 'data/normalized/etf-master.json'),
  metadata: resolve(ROOT, 'data/normalized/etf-metadata.json'),
  registry: resolve(ROOT, 'config/issuer-registry.json'),
  officialProbe: resolve(ROOT, 'data/reports/metadata-v2/publicdata-live-probe-summary.json'),
  output: resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'),
};

export function normalizeIssuerName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/주식회사|\(주\)|㈜/g, '')
    .replace(/[\s._-]+/g, '')
    .toLowerCase();
}

export function isinCandidateForShortCode(shortCode) {
  const code = String(shortCode || '').trim().toUpperCase();
  if (!/^[0-9A-Z]{6}$/.test(code)) return null;
  const base = `KR7${code}00`;
  const expanded = [...base]
    .map((char) => /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char)
    .join('');
  let sum = 0;
  let double = true;
  for (let index = expanded.length - 1; index >= 0; index -= 1) {
    let digit = Number(expanded[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return base + String((10 - (sum % 10)) % 10);
}

function makeRegistryIndex(registry) {
  const byBrand = new Map();
  for (const issuer of registry.issuers || []) {
    for (const brand of issuer.brands || []) {
      if (byBrand.has(brand)) throw new Error(`duplicate issuer brand: ${brand}`);
      byBrand.set(brand, issuer);
    }
  }
  return byBrand;
}

function matchesIssuerName(value, issuer) {
  const target = normalizeIssuerName(value);
  if (!target) return false;
  return [issuer.legalNameKo, issuer.displayNameKo, ...(issuer.aliases || [])]
    .some((candidate) => normalizeIssuerName(candidate) === target);
}

function ratio(count, total) {
  return total ? Number((count / total).toFixed(6)) : 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function buildIssuerInventory({ master, metadata, registry, officialProbe = null, generatedAt = new Date().toISOString() }) {
  const inputRows = Array.isArray(master?.etfs) ? master.etfs : [];
  if (!inputRows.length) throw new Error('master.etfs is empty');
  if (master.etfCount != null && master.etfCount !== inputRows.length) {
    throw new Error(`master count mismatch: ${master.etfCount} != ${inputRows.length}`);
  }
  const duplicateCodes = inputRows
    .map((row) => row.etfCode)
    .filter((code, index, all) => all.indexOf(code) !== index);
  if (duplicateCodes.length) throw new Error(`duplicate master ETF codes: ${[...new Set(duplicateCodes)].join(', ')}`);

  const byBrand = makeRegistryIndex(registry);
  const metadataByCode = new Map((metadata?.records || []).map((record) => [record.etfCode, record]));
  const rows = inputRows.map((source, index) => {
    const brand = String(source.name || '').trim().split(/\s+/)[0] || null;
    const issuer = brand ? byBrand.get(brand) : null;
    const localMetadata = metadataByCode.get(source.etfCode);
    const localIssuer = localMetadata?.issuer || null;
    const issuerConflict = Boolean(localIssuer && issuer && !matchesIssuerName(localIssuer, issuer));
    const numericCode = /^\d{6}$/.test(source.etfCode);
    const codeFormatValid = /^[0-9A-Z]{6}$/.test(source.etfCode);
    const unresolvedReasons = [];
    if (!issuer) unresolvedReasons.push('issuer_brand_not_in_registry');
    if (!codeFormatValid) unresolvedReasons.push('invalid_short_code_format');
    if (!numericCode) unresolvedReasons.push('alphanumeric_short_code_needs_official_verification');
    if (issuerConflict) unresolvedReasons.push('local_metadata_issuer_conflict');

    return {
      universeOrdinal: index + 1,
      sourceRecord: { ...source },
      brand,
      issuer: issuer ? {
        id: issuer.id,
        legalNameKo: issuer.legalNameKo,
        displayNameKo: issuer.displayNameKo,
        resolution: localIssuer && !issuerConflict ? 'brand_registry_and_local_metadata' : 'brand_registry',
        localMetadataValue: localIssuer,
        needsOfficialVerification: !localIssuer,
      } : {
        id: null,
        legalNameKo: null,
        displayNameKo: null,
        resolution: 'unresolved',
        localMetadataValue: localIssuer,
        needsOfficialVerification: true,
      },
      identifiers: {
        sourceEtfCode: source.etfCode,
        sourceCodeType: source.codeType,
        shortCodeFormat: numericCode ? 'numeric_6' : codeFormatValid ? 'alphanumeric_6' : 'invalid',
        krxShortCodeCandidate: codeFormatValid ? source.etfCode : null,
        isinCandidate: isinCandidateForShortCode(source.etfCode),
        candidateDerivation: codeFormatValid ? 'ISO_6166_KR7_short_code_00_check_digit' : null,
        officialVerification: numericCode ? 'master_asserted_krx_numeric' : 'pending_publicdata_or_kind',
      },
      reconciliation: {
        preservedFromMaster: true,
        issuerConflict,
        unresolvedReasons,
      },
    };
  });

  const issuerResolved = rows.filter((row) => row.issuer.id).length;
  const issuerLocallyConfirmed = rows.filter((row) => row.issuer.resolution === 'brand_registry_and_local_metadata').length;
  const numericCodes = rows.filter((row) => row.identifiers.shortCodeFormat === 'numeric_6').length;
  const alphanumericCodes = rows.filter((row) => row.identifiers.shortCodeFormat === 'alphanumeric_6').length;
  const issuerConflicts = rows.filter((row) => row.reconciliation.issuerConflict).length;
  const officialIdentifierPending = rows.filter((row) => row.identifiers.officialVerification === 'pending_publicdata_or_kind').length;
  const localCodes = new Set(rows.map((row) => row.sourceRecord.etfCode));
  const officialOnlyCodes = officialProbe?.delta?.officialOnlyCodes || [];
  const localOnlyCodes = officialProbe?.delta?.localOnlyCodes || [];
  for (const code of localOnlyCodes) {
    if (!localCodes.has(code)) throw new Error(`official probe local-only code missing from master: ${code}`);
  }
  for (const code of officialOnlyCodes) {
    if (localCodes.has(code)) throw new Error(`official probe official-only code already exists in master: ${code}`);
  }

  const issuerSummaries = (registry.issuers || []).map((issuer) => {
    const issuerRows = rows.filter((row) => row.issuer.id === issuer.id);
    return {
      issuerId: issuer.id,
      legalNameKo: issuer.legalNameKo,
      displayNameKo: issuer.displayNameKo,
      brands: issuer.brands,
      etfCount: issuerRows.length,
      numericCodeCount: issuerRows.filter((row) => row.identifiers.shortCodeFormat === 'numeric_6').length,
      alphanumericCodeCount: issuerRows.filter((row) => row.identifiers.shortCodeFormat === 'alphanumeric_6').length,
      localMetadataConfirmedCount: issuerRows.filter((row) => row.issuer.resolution === 'brand_registry_and_local_metadata').length,
      officialVerificationPendingCount: issuerRows.filter((row) => row.issuer.needsOfficialVerification).length,
    };
  }).filter((issuer) => issuer.etfCount > 0).sort((a, b) => b.etfCount - a.etfCount || a.issuerId.localeCompare(b.issuerId));

  return {
    schemaVersion: '1.0.0',
    generatedAt,
    scope: {
      mode: 'local_only_no_network',
      masterSource: master.source || null,
      masterGeneratedAt: master.generatedAt || null,
      inputEtfCount: inputRows.length,
      outputEtfCount: rows.length,
      inputFingerprintSha256: sha256(JSON.stringify(inputRows)),
      rowOrderPreserved: rows.every((row, index) => row.sourceRecord.etfCode === inputRows[index].etfCode),
      officialCurrentUniverseCount: officialProbe?.officialUniverse?.etfCount ?? null,
      officialUniverseAsOfDate: officialProbe?.officialUniverse?.basDt ?? null,
      officialUniverseReconciliationStatus: officialProbe ? 'reconciled_from_probe_summary' : 'pending_approved_publicdata_or_kind_snapshot',
    },
    universeReconciliation: officialProbe ? {
      source: officialProbe.source,
      sourceUrl: officialProbe.sourceUrl,
      basDt: officialProbe.officialUniverse.basDt,
      localCount: rows.length,
      officialCount: officialProbe.officialUniverse.etfCount,
      exactCodeOverlapCount: officialProbe.delta.exactCodeOverlapCount,
      officialOnlyCount: officialOnlyCodes.length,
      officialOnlyCodes,
      localOnlyCount: localOnlyCodes.length,
      localOnlyCodes,
      countDifference: officialProbe.officialUniverse.etfCount - rows.length,
      action: 'preserve_local_1141_until_additions_and_removal_are_individually_reviewed',
    } : null,
    coverage: {
      issuerResolved: { count: issuerResolved, ratio: ratio(issuerResolved, rows.length) },
      issuerLocallyConfirmed: { count: issuerLocallyConfirmed, ratio: ratio(issuerLocallyConfirmed, rows.length) },
      issuerOfficialVerificationPending: { count: rows.length - issuerLocallyConfirmed, ratio: ratio(rows.length - issuerLocallyConfirmed, rows.length) },
      identifierNumericMasterAsserted: { count: numericCodes, ratio: ratio(numericCodes, rows.length) },
      identifierAlphanumericOfficialVerificationPending: { count: officialIdentifierPending, ratio: ratio(officialIdentifierPending, rows.length) },
      isinCandidateDerived: { count: rows.filter((row) => row.identifiers.isinCandidate).length, ratio: ratio(rows.filter((row) => row.identifiers.isinCandidate).length, rows.length) },
      issuerConflicts: { count: issuerConflicts, ratio: ratio(issuerConflicts, rows.length) },
      unresolvedIssuer: { count: rows.length - issuerResolved, ratio: ratio(rows.length - issuerResolved, rows.length) },
      shortCodeFormat: { numeric6: numericCodes, alphanumeric6: alphanumericCodes, invalid: rows.length - numericCodes - alphanumericCodes },
    },
    caveats: [
      'Brand resolution covers the local universe but is not official per-product issuer verification.',
      'The original master sourceRecord, row count, row order, and source codeType are preserved without mutation.',
      'Alphanumeric six-character codes are retained as candidates and require PublicData or KIND verification; they are not discarded as invalid.',
      'ISIN values are deterministic candidates derived from the short code and require official-source confirmation.',
      officialProbe
        ? 'The live PublicData probe is represented only by a non-secret aggregate and code-delta summary; raw API responses and credentials are not stored.'
        : 'No current official universe was supplied, so listing additions and removals remain unreconciled.'
    ],
    issuers: issuerSummaries,
    rows,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const master = await readJson(DEFAULTS.master);
  const metadata = await readJson(DEFAULTS.metadata);
  const registry = await readJson(DEFAULTS.registry);
  const officialProbe = await readJson(DEFAULTS.officialProbe);
  const inventory = buildIssuerInventory({ master, metadata, registry, officialProbe });
  await mkdir(dirname(DEFAULTS.output), { recursive: true });
  await writeFile(DEFAULTS.output, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: DEFAULTS.output, scope: inventory.scope, coverage: inventory.coverage }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`[metadata-v2:issuer-inventory] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
