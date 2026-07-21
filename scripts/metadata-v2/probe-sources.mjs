import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProbeProvider } from './providers/registry.mjs';
import {
  EXECUTION_POLICY,
  FIELD_KEYS,
  PROBE_STATUS,
  makeProbeResult,
  validateProbeConfig,
} from './providers/contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_CONFIG = resolve(ROOT, 'config/metadata-source-probe.json');
const DEFAULT_JSON = resolve(ROOT, 'data/reports/metadata-v2/source-probe.json');
const DEFAULT_CSV = resolve(ROOT, 'data/reports/metadata-v2/source-probe.csv');
const DEFAULT_MD = resolve(ROOT, 'data/reports/metadata-v2/source-probe.md');

function parseArgs(argv) {
  const args = { network: false, sources: null, limit: null };
  for (const value of argv) {
    if (value === '--network') args.network = true;
    else if (value.startsWith('--source=')) args.sources = new Set(value.slice(9).split(',').filter(Boolean));
    else if (value.startsWith('--limit=')) args.limit = Number(value.slice(8));
    else if (value === '--help') args.help = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  if (args.limit != null && (!Number.isInteger(args.limit) || args.limit < 1)) throw new Error('--limit must be a positive integer');
  return args;
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

export async function runProbe(config, options = {}) {
  validateProbeConfig(config);
  const network = options.network === true;
  const selectedSources = options.sources || null;
  const maxNetwork = Math.min(
    Number.isInteger(options.limit) ? options.limit : config.maxNetworkCanaries,
    config.maxNetworkCanaries,
  );
  const sourceById = new Map(config.sources.map((source) => [source.sourceId, source]));
  const canaries = config.canaries.filter((canary) => !selectedSources || selectedSources.has(canary.sourceId));
  const results = [];
  let networkCount = 0;
  const networkCountBySource = new Map();
  const lastRequestAt = new Map();

  for (const canary of canaries) {
    const source = sourceById.get(canary.sourceId);
    if (source.executionPolicy === EXECUTION_POLICY.BLOCKED_PENDING_TERMS) {
      results.push(await createProbeProvider(source, options.providerOptions?.[source.sourceId]).probe(canary));
      continue;
    }
    if (!network || networkCount >= maxNetwork) {
      results.push(makeProbeResult({
        source,
        canary,
        status: PROBE_STATUS.NOT_RUN,
        error: new Error(network ? 'network canary cap reached' : 'network disabled; pass --network to opt in'),
      }));
      continue;
    }
    const sourceNetworkCount = networkCountBySource.get(source.sourceId) || 0;
    if (sourceNetworkCount >= (source.networkCanaryLimit || Number.POSITIVE_INFINITY)) {
      results.push(makeProbeResult({
        source,
        canary,
        status: PROBE_STATUS.NOT_RUN,
        error: new Error(`source canary cap reached (${source.networkCanaryLimit})`),
      }));
      continue;
    }

    const prior = lastRequestAt.get(source.host) || 0;
    const waitMs = Math.max(0, config.hostIntervalMs - (Date.now() - prior));
    if (waitMs > 0) await (options.sleep || delay)(waitMs);
    lastRequestAt.set(source.host, Date.now());
    const provider = createProbeProvider(source, options.providerOptions?.[source.sourceId]);
    results.push(await provider.probe(canary, options.context || {}));
    networkCount += 1;
    networkCountBySource.set(source.sourceId, sourceNetworkCount + 1);
  }

  return buildReport(config, results, { network, networkCount });
}

export function buildReport(config, results, run) {
  const sourceSummaries = config.sources.map((source) => {
    const rows = results.filter((result) => result.sourceId === source.sourceId);
    const statuses = Object.fromEntries(Object.values(PROBE_STATUS).map((status) => [status, rows.filter((row) => row.status === status).length]));
    const fieldSuccess = Object.fromEntries(FIELD_KEYS.map((field) => [field, rows.filter((row) => row.fields[field]).length]));
    return {
      sourceId: source.sourceId,
      issuer: source.issuer,
      adapter: source.adapter,
      executionPolicy: source.executionPolicy,
      termsStatus: source.termsStatus,
      officialUrl: source.officialUrl,
      canaryCount: rows.length,
      statuses,
      fieldSuccess,
    };
  });
  return {
    version: config.version,
    generatedAt: new Date().toISOString(),
    mode: run.network ? 'network_opt_in' : 'offline_plan_only',
    networkRequestCount: run.networkCount,
    canaryCount: results.length,
    strata: [...new Set(results.flatMap((result) => result.strata))].sort(),
    guardrails: {
      hostIntervalMs: config.hostIntervalMs,
      maxNetworkCanaries: config.maxNetworkCanaries,
      blockedSourcesRequireTermsReview: true,
    },
    sourceSummaries,
    results,
  };
}

function csvEscape(value) {
  const stringValue = value == null ? '' : String(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

export function reportToCsv(report) {
  const fields = ['sourceId', 'issuer', 'etfCode', 'name', 'strata', 'status', 'rowCount', 'asOfDate', 'upstreamStatus', ...FIELD_KEYS, 'executionPolicy', 'termsStatus', 'sourceUrl', 'error'];
  const lines = [fields.join(',')];
  for (const row of report.results) {
    const values = {
      ...row,
      strata: row.strata.join('|'),
      ...Object.fromEntries(FIELD_KEYS.map((field) => [field, row.fields[field]])),
    };
    lines.push(fields.map((field) => csvEscape(values[field])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function reportToMarkdown(report) {
  const lines = [
    '# ETF metadata source probe',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Stratified canaries: ${report.canaryCount}`,
    `- Network canaries executed: ${report.networkRequestCount}`,
    `- Per-host minimum interval: ${report.guardrails.hostIntervalMs}ms`,
    '',
    '| Source | Policy | Terms | Canaries | OK | Partial | Failed | Blocked | Holdings |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const source of report.sourceSummaries) {
    lines.push(`| ${source.sourceId} | ${source.executionPolicy} | ${source.termsStatus} | ${source.canaryCount} | ${source.statuses.ok} | ${source.statuses.partial} | ${source.statuses.failed} | ${source.statuses.blocked_pending_terms} | ${source.fieldSuccess.holdings} |`);
  }
  lines.push(
    '',
    '## Interpretation',
    '',
    '- `blocked_pending_terms` is intentional: no request is sent until robots.txt and issuer terms are reviewed.',
    '- The existing KODEX/TIGER wrapper currently probes holdings only. Other metadata fields remain false even when holdings succeed.',
    '- This probe is a readiness check, not the 1,141-ETF collection run.',
    '',
  );
  return lines.join('\n');
}

function writeReport(report) {
  mkdirSync(dirname(DEFAULT_JSON), { recursive: true });
  writeFileSync(DEFAULT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(DEFAULT_CSV, reportToCsv(report), 'utf8');
  writeFileSync(DEFAULT_MD, reportToMarkdown(report), 'utf8');
}

function preserveUnselectedResults(report, selectedSources, config) {
  if (!selectedSources) return report;
  try {
    const prior = JSON.parse(readFileSync(DEFAULT_JSON, 'utf8'));
    const preserved = (prior.results || []).filter((row) => !selectedSources.has(row.sourceId));
    if (preserved.length === 0) return report;
    const mergedResults = [...preserved, ...report.results];
    return {
      ...buildReport(config, mergedResults, { network: report.mode === 'network_opt_in', networkCount: report.networkRequestCount }),
      preservedSourceIds: [...new Set(preserved.map((row) => row.sourceId))],
      currentRunSourceIds: [...selectedSources],
    };
  } catch {
    return report;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/metadata-v2/probe-sources.mjs [--network] [--source=issuer_kodex,issuer_tiger] [--limit=8]');
    return;
  }
  const config = JSON.parse(readFileSync(DEFAULT_CONFIG, 'utf8'));
  const currentReport = await runProbe(config, args);
  const report = preserveUnselectedResults(currentReport, args.sources, config);
  writeReport(report);
  console.log(`[metadata-v2:probe] ${report.mode}: ${report.canaryCount} canaries, ${report.networkRequestCount} network probes`);
  console.log(`[metadata-v2:probe] reports: ${DEFAULT_JSON}, ${DEFAULT_CSV}, ${DEFAULT_MD}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`[metadata-v2:probe] ${error.message}`);
    process.exitCode = 1;
  });
}
