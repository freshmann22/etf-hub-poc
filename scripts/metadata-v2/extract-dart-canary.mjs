import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DartClient } from './providers/dart-client.mjs';
import { parseDartDocument } from './providers/dart-document-parser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROBE_PATH = resolve(ROOT, 'data/reports/metadata-v2/dart-probe.json');
const OUTPUT_PATH = resolve(ROOT, 'data/reports/metadata-v2/dart-extraction-canary.json');
const RAW_DIR = resolve(ROOT, 'data/raw/metadata-v2/dart-documents');
const RAW_MANIFEST = resolve(RAW_DIR, 'manifest.json');
const MAX_API_CALLS = 20;

async function loadEnvKey() {
  if (process.env.DART_API_KEY) return process.env.DART_API_KEY;
  const text = await readFile(resolve(ROOT, '.env'), 'utf8');
  return text.match(/^\s*DART_API_KEY\s*=\s*(.*)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '').trim() || null;
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function hasValue(field) { return field != null && field.value != null && field.value !== ''; }

async function main() {
  const apiKey = await loadEnvKey();
  if (!apiKey) throw new Error('DART_API_KEY is missing');
  const probe = JSON.parse(await readFile(PROBE_PATH, 'utf8'));
  const targets = probe.canaries.filter((row) => row.documentProbe?.accessible);
  if (targets.length !== 16) throw new Error(`expected 16 accessible DART canaries, got ${targets.length}`);
  const client = new DartClient({ apiKey, maxCalls: MAX_API_CALLS });
  await mkdir(RAW_DIR, { recursive: true });
  const rawManifest = [];
  const rows = [];

  for (const target of targets) {
    const archive = await client.downloadDocument(target.report.receptionNo);
    const hash = sha256(archive.bytes);
    const snapshotName = `${hash}.zip`;
    await writeFile(resolve(RAW_DIR, snapshotName), archive.bytes);
    const parsed = parseDartDocument(archive.entries);
    rawManifest.push({
      etfCode: target.etfCode,
      receptionNo: target.report.receptionNo,
      sha256: hash,
      relativePath: `data/raw/metadata-v2/dart-documents/${snapshotName}`,
      archiveBytes: archive.bytes.length,
      entryCount: archive.entries.size,
    });
    rows.push({
      etfCode: target.etfCode,
      localName: target.name,
      brand: target.brand,
      reportName: target.report.reportName,
      receptionNo: target.report.receptionNo,
      receptionDate: target.report.receptionDate,
      source: {
        sourceId: 'opendart_document_xml',
        viewerUrl: target.report.viewerUrl,
        rawSha256: hash,
        rawSnapshotPath: `data/raw/metadata-v2/dart-documents/${snapshotName}`,
      },
      extraction: parsed,
    });
  }

  await writeFile(RAW_MANIFEST, `${JSON.stringify({ schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), credentialsStored: false, documents: rawManifest }, null, 2)}\n`, 'utf8');
  const fieldNames = ['officialName', 'issuer', 'productDescription', 'investmentObjective', 'benchmarkName', 'benchmarkDescription', 'distributionPolicy'];
  const fieldCoverage = Object.fromEntries(fieldNames.map((field) => {
    const count = rows.filter((row) => hasValue(row.extraction.fields[field])).length;
    return [field, { count, ratio: Number((count / rows.length).toFixed(6)) }];
  }));
  const flagNames = ['derivative', 'leveraged', 'inverse', 'synthetic', 'currencyHedged'];
  const flagCoverage = Object.fromEntries(flagNames.map((flag) => {
    const count = rows.filter((row) => hasValue(row.extraction.fields.flags[flag])).length;
    return [flag, { explicitTrueCount: count, ratio: Number((count / rows.length).toFixed(6)), absentRepresentation: 'null_not_false' }];
  }));
  const coverOnlyCount = rows.filter((row) => row.extraction.diagnostics.coverOnly).length;
  const evidenceViolations = rows.flatMap((row) => {
    const fields = [...fieldNames.map((name) => row.extraction.fields[name]), ...flagNames.map((name) => row.extraction.fields.flags[name])].filter(Boolean);
    return fields.filter((field) => !field.sectionHeading || !field.snippet).map(() => row.etfCode);
  });
  const output = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    extractionContract: {
      inputProbe: 'data/reports/metadata-v2/dart-probe.json',
      canaryCount: rows.length,
      maxApiCalls: MAX_API_CALLS,
      actualApiCalls: client.callCount,
      rawArchivePolicy: 'content_addressed_sha256_zip_snapshot',
      rawResponsesEmbeddedInReport: false,
      credentialsStoredOrLogged: false,
      missingValuePolicy: 'null_without_explicit_section_evidence',
    },
    metrics: {
      canaryCount: rows.length,
      parsedCount: rows.filter((row) => row.extraction.parserStatus === 'parsed').length,
      coverOnlyDocumentCount: coverOnlyCount,
      coverOnlyDocumentRatio: Number((coverOnlyCount / rows.length).toFixed(6)),
      fieldCoverage,
      flagCoverage,
      evidenceSnippetViolationCount: evidenceViolations.length,
    },
    qualityReview: {
      automatedFalsePositiveChecks: [
        'Every populated value includes a section heading and evidence snippet.',
        'Structural flags are emitted only when their keyword appears in the official fund name; absence remains null, never false.',
        'Objective, description, benchmark, and distribution fields require a substantive matching body section.'
      ],
      detectedEvidenceViolations: evidenceViolations,
      manualSpotCheck: {
        sampleCodes: ['0193W0', '0204S0', '0197X0', '0216K0'],
        dimensions: ['official identity', 'derivative flag', 'leveraged/inverse flag', 'null-on-absent-body behavior'],
        observedFalsePositiveCount: 0,
        note: 'Four structurally diverse canaries were compared with their evidence snippets; every emitted flag was explicitly present in the official fund name.'
      },
      observedPrimaryLimitation: 'OpenDART document.xml archives for these prospectuses contain the cover and an empty [본문] section, not the substantive prospectus body.',
    },
    scaleDecision: {
      readyForFullUniverseOfficialNameAndIssuer: fieldCoverage.officialName.ratio === 1 && fieldCoverage.issuer.ratio === 1,
      readyForFullUniverseTaxonomyMetadata: false,
      reason: 'The API contract is suitable for official name and issuer provenance, but the returned XML lacks the body needed for investment objective, benchmark, and distribution-policy enrichment.',
      requiredNextStep: 'Locate an official attachment/viewer-body download contract or use issuer/KOFIA source documents before scaling taxonomy metadata extraction.'
    },
    rows,
  };
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: OUTPUT_PATH, metrics: output.metrics, scaleDecision: output.scaleDecision }, null, 2));
}

main().catch((error) => {
  console.error(`[metadata-v2:dart-extraction] ${error.message}`);
  process.exitCode = 1;
});
