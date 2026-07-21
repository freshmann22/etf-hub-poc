import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = resolve(ROOT, 'data/reports/metadata-v2/dart-disclosure-index.json');
const LEDGER = resolve(ROOT, 'data/raw/metadata-v2/dart-pdf-batch/ledger.jsonl');
const REPORT = resolve(ROOT, 'data/reports/metadata-v2/dart-pdf-batch-progress.json');
const KNOWN_STATUSES = ['ok', 'quarantine', 'pending_ocr', 'error', 'blocked'];

export function parseLatestLedger(text) {
  const latest = new Map();
  let validLineCount = 0;
  let malformedLineCount = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!row.universeKey) throw new Error('missing universeKey');
      latest.set(row.universeKey, row);
      validLineCount += 1;
    } catch {
      malformedLineCount += 1;
    }
  }
  return { latest, validLineCount, malformedLineCount };
}

export function buildProgress(index, ledgerText, generatedAt = new Date().toISOString()) {
  const targets = new Set(index.rows.filter((row) => row.status === 'mapped').map((row) => row.universeKey));
  const { latest, validLineCount, malformedLineCount } = parseLatestLedger(ledgerText);
  const targetRows = [...latest.values()].filter((row) => targets.has(row.universeKey));
  const statusCounts = Object.fromEntries(KNOWN_STATUSES.map((status) => [status, 0]));
  let unknown = 0;
  for (const row of targetRows) {
    if (Object.hasOwn(statusCounts, row.status)) statusCounts[row.status] += 1;
    else unknown += 1;
  }
  const targetCount = targets.size;
  const attemptedCount = targetRows.length;
  return {
    schemaVersion: '1.0.0',
    generatedAt,
    sourceIndex: 'data/reports/metadata-v2/dart-disclosure-index.json',
    sourceLedger: 'data/raw/metadata-v2/dart-pdf-batch/ledger.jsonl',
    readOnly: true,
    metrics: {
      targetCount,
      attemptedCount,
      successfulCount: statusCounts.ok,
      unresolvedAttemptCount: attemptedCount - statusCounts.ok,
      notAttemptedCount: Math.max(0, targetCount - attemptedCount),
      completionPct: targetCount ? Number(((attemptedCount / targetCount) * 100).toFixed(2)) : 0,
      successPct: targetCount ? Number(((statusCounts.ok / targetCount) * 100).toFixed(2)) : 0,
      statusCounts: { ...statusCounts, unknown },
      ledger: { validLineCount, malformedLineCount, latestKeyCount: latest.size, outOfScopeLatestCount: latest.size - targetRows.length },
    },
  };
}

async function main() {
  const [indexText, ledgerText] = await Promise.all([readFile(INDEX, 'utf8'), readFile(LEDGER, 'utf8')]);
  const report = buildProgress(JSON.parse(indexText), ledgerText);
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: REPORT, metrics: report.metrics }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[dart-progress] ${error.message}`);
    process.exitCode = 1;
  });
}
