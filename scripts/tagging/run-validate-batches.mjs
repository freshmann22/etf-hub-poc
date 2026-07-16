// 배치 결과 파일들을 스키마 검증하고 sanitized 결과를 저장한다(§11).
//   실행: node scripts/tagging/run-validate-batches.mjs [batch-0001 batch-0002 ...]
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { readJsonCache, writeJsonCache, cacheExists } from '../metadata/lib/cache.js';
import { validateBatchResult } from './validate-batch-result.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUTS_DIR = resolve(ROOT, 'data/tagging/batches/outputs');
const STATE_DIR = resolve(ROOT, 'data/tagging/batches/state');
const VALIDATED_DIR = resolve(ROOT, 'data/tagging/batches/validated');

function main() {
  const batchIds = process.argv.slice(2);
  for (const batchId of batchIds) {
    const statePath = resolve(STATE_DIR, `${batchId}.state.json`);
    const outputPath = resolve(OUTPUTS_DIR, `${batchId}.result.json`);
    if (!cacheExists(statePath) || !cacheExists(outputPath)) {
      console.error(`[validate] ${batchId}: state 또는 output 파일 없음, 건너뜀`);
      continue;
    }
    const state = readJsonCache(statePath);
    const raw = readFileSync(outputPath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`[validate] ${batchId}: JSON 파싱 실패 — ${err.message} (원문 보존)`);
      state.status = 'failed';
      state.error = `parse error: ${err.message}`;
      writeJsonCache(statePath, state);
      continue;
    }
    const result = validateBatchResult(parsed, state.etfCodes);
    writeJsonCache(resolve(VALIDATED_DIR, `${batchId}.validated.json`), result);

    state.status = result.valid ? 'done' : 'needs_review';
    state.attempts = (state.attempts || 0) + 1;
    state.validatedAt = new Date().toISOString();
    state.unexpectedCodes = result.unexpectedCodes;
    state.missingCodes = result.missingCodes;
    writeJsonCache(statePath, state);

    console.log(
      `[validate] ${batchId}: valid=${result.valid} | ok=${result.perEtf.filter((p) => p.ok).length}/${result.perEtf.length} | unexpected=${result.unexpectedCodes.length} | missing=${result.missingCodes.length}`
    );
    for (const p of result.perEtf) {
      if (!p.ok) console.log(`    ${p.etfCode}: ${p.errors.join('; ')}`);
      if (p.warnings.length) console.log(`    ${p.etfCode} (경고): ${p.warnings.join('; ')}`);
    }
  }
}

main();
