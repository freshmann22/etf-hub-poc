// compact tagging input을 배치로 분할한다(§9). 이미 완료된 배치는 재생성하지 않는다(증분).
//   실행: npm run tagging:prepare 이후
//     node scripts/tagging/build-batches.mjs [--batch-size=15] [--etf=069500,102110] [--limit=N] [--start-batch=5] [--force]
//   출력: data/tagging/batches/inputs/batch-XXXX.json, data/tagging/batches/state/batch-XXXX.state.json
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { writeJsonCache, readJsonCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INPUT_JSONL = resolve(ROOT, 'data/tagging/etf-tagging-input.jsonl');
const BATCH_INPUT_DIR = resolve(ROOT, 'data/tagging/batches/inputs');
const BATCH_STATE_DIR = resolve(ROOT, 'data/tagging/batches/state');

function parseArgs(argv) {
  const args = { batchSize: 15, etf: null, limit: null, startBatch: 1, force: false };
  for (const raw of argv) {
    if (raw === '--force') args.force = true;
    else if (raw.startsWith('--batch-size=')) args.batchSize = Number(raw.slice('--batch-size='.length));
    else if (raw.startsWith('--etf=')) args.etf = raw.slice('--etf='.length).split(',').map((s) => s.trim());
    else if (raw.startsWith('--limit=')) args.limit = Number(raw.slice('--limit='.length));
    else if (raw.startsWith('--start-batch=')) args.startBatch = Number(raw.slice('--start-batch='.length));
  }
  return args;
}

function loadJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length)
    .map((l) => JSON.parse(l));
}

function pad4(n) {
  return String(n).padStart(4, '0');
}

export function buildBatches(argvOverride) {
  if (!cacheExists(INPUT_JSONL)) throw new Error('먼저 npm run tagging:prepare 를 실행하세요.');
  const args = parseArgs(argvOverride ?? process.argv.slice(2));
  let records = loadJsonl(INPUT_JSONL);

  if (args.etf) {
    const wanted = new Set(args.etf);
    records = records.filter((r) => wanted.has(r.etfCode));
  }
  if (args.limit) records = records.slice(0, args.limit);

  const batches = [];
  for (let i = 0; i < records.length; i += args.batchSize) {
    batches.push(records.slice(i, i + args.batchSize));
  }

  const manifest = [];
  for (let i = 0; i < batches.length; i++) {
    const batchNum = args.startBatch + i;
    const batchId = `batch-${pad4(batchNum)}`;
    const inputPath = resolve(BATCH_INPUT_DIR, `${batchId}.json`);
    const statePath = resolve(BATCH_STATE_DIR, `${batchId}.state.json`);

    if (!args.force && cacheExists(statePath)) {
      const existingState = readJsonCache(statePath);
      if (existingState.status === 'done') {
        manifest.push({ batchId, etfCount: batches[i].length, status: 'done (스킵 — 이미 완료)' });
        continue; // 완료된 배치는 재생성하지 않음
      }
    }

    const etfCodes = batches[i].map((r) => r.etfCode);
    writeJsonCache(inputPath, { batchId, generatedAt: new Date().toISOString(), etfCodes, inputs: batches[i] });
    writeJsonCache(statePath, {
      batchId,
      status: 'pending',
      etfCodes,
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    manifest.push({ batchId, etfCount: batches[i].length, status: 'pending' });
  }

  return { totalRecords: records.length, batchSize: args.batchSize, batchCount: batches.length, manifest };
}

function main() {
  const result = buildBatches();
  console.log(`[tagging:build-batches] 대상 ${result.totalRecords}종 → 배치 ${result.batchCount}개 (배치당 ${result.batchSize}종)`);
  for (const m of result.manifest) console.log(`  ${m.batchId}: ${m.etfCount}종 [${m.status}]`);
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') || process.argv[1]?.endsWith('build-batches.mjs')) {
  main();
}
