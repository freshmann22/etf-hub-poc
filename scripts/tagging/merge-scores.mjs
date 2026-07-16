// 규칙 결과 + worker(검증됨) + reviewer correction 을 병합해 최종 태그 스코어를 만든다(§15).
//   실행: node scripts/tagging/merge-scores.mjs [batch-0001 batch-0002 ...]  (인자 없으면 validated 전체)
//   출력: data/tagging/etf-llm-scores.json (LLM측 원본 통합), data/tagging/etf-tag-scores.json (규칙+LLM 최종 병합),
//         data/tagging/etf-candidate-tags-raw.json (auditor 입력), data/tagging/etf-scoring-cache.json (입력해시 캐시)
//   --taxonomy=/--rule-scores=/--batches-dir=/--out-dir= 로 개별 override 가능(기본은 위 canonical 경로).
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readJsonCache, writeJsonCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs() {
  const out = {};
  const positional = [];
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else positional.push(arg);
  }
  return { flags: out, positional };
}
const { flags: cliFlags, positional: cliPositional } = parseArgs();

const BATCHES_DIR = resolve(ROOT, cliFlags['batches-dir'] || 'data/tagging/batches');
const VALIDATED_DIR = resolve(BATCHES_DIR, 'validated');
const REVIEWS_DIR = resolve(BATCHES_DIR, 'reviews');
const INPUTS_DIR = resolve(BATCHES_DIR, 'inputs');
const RULE_SCORES_FILE = resolve(ROOT, cliFlags['rule-scores'] || 'data/tagging/etf-rule-scores.json');
const TAXONOMY_FILE = resolve(ROOT, cliFlags.taxonomy || 'config/etf-tagging/etf-taxonomy.json');
const OUT_DIR = resolve(ROOT, cliFlags['out-dir'] || 'data/tagging');
const OUT_LLM = resolve(OUT_DIR, 'etf-llm-scores.json');
const OUT_FINAL = resolve(OUT_DIR, 'etf-tag-scores.json');
const OUT_CANDIDATES_RAW = resolve(OUT_DIR, 'etf-candidate-tags-raw.json');
const OUT_CACHE = resolve(OUT_DIR, 'etf-scoring-cache.json');
const TAXONOMY_VERSION_FALLBACK = '1.0.0';
const WORKER_PROMPT_VERSION = '1.0.0';

function loadReviewCorrections(batchId) {
  const p = resolve(REVIEWS_DIR, `${batchId}.review.json`);
  if (!cacheExists(p)) return new Map();
  const arr = readJsonCache(p) || [];
  return new Map(arr.map((item) => [item.etfCode, item]));
}

function inputHash(inputRecord) {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(inputRecord)).digest('hex');
}

function main() {
  const explicitBatchIds = cliPositional;
  const batchIds = explicitBatchIds.length
    ? explicitBatchIds
    : (cacheExists(VALIDATED_DIR) ? readdirSync(VALIDATED_DIR) : []).filter((f) => f.endsWith('.validated.json')).map((f) => f.replace('.validated.json', ''));

  const taxonomy = readJsonCache(TAXONOMY_FILE);
  const taxonomyMap = new Map(taxonomy.tags.map((t) => [t.id, t]));
  const ruleScores = cacheExists(RULE_SCORES_FILE) ? readJsonCache(RULE_SCORES_FILE) : { results: [] };
  const ruleByCode = new Map(ruleScores.results.map((r) => [r.etfCode, r]));

  const llmByCode = new Map();
  const cacheEntries = [];

  for (const batchId of batchIds) {
    const validatedPath = resolve(VALIDATED_DIR, `${batchId}.validated.json`);
    if (!cacheExists(validatedPath)) {
      console.warn(`[merge] ${batchId}: validated 파일 없음, 건너뜀`);
      continue;
    }
    const validated = readJsonCache(validatedPath);
    const corrections = loadReviewCorrections(batchId);
    const inputPath = resolve(INPUTS_DIR, `${batchId}.json`);
    const inputRecordsByCode = cacheExists(inputPath)
      ? new Map(readJsonCache(inputPath).inputs.map((r) => [r.etfCode, r]))
      : new Map();

    for (const p of validated.perEtf) {
      if (!p.ok || !p.sanitized) continue;
      const correction = corrections.get(p.etfCode);
      const finalClassifications = correction ? correction.correctedClassifications : p.sanitized.classifications;
      llmByCode.set(p.etfCode, {
        etfCode: p.etfCode,
        classifications: finalClassifications,
        candidateTags: p.sanitized.candidateTags,
        reviewIssues: correction ? correction.issues : [],
        batchId,
      });

      const inputRecord = inputRecordsByCode.get(p.etfCode);
      if (inputRecord) {
        cacheEntries.push({
          etfCode: p.etfCode,
          inputHash: inputHash(inputRecord),
          taxonomyVersion: taxonomy.version || TAXONOMY_VERSION_FALLBACK,
          workerPromptVersion: WORKER_PROMPT_VERSION,
          scoringMethod: 'claude-code-subagent',
          scoredAt: new Date().toISOString(),
          batchId,
        });
      }
    }
  }

  writeJsonCache(OUT_LLM, { generatedAt: new Date().toISOString(), etfCount: llmByCode.size, etfs: Object.fromEntries(llmByCode) });

  // candidateTags 원본 집계(auditor 입력) — 정규화는 auditor 몫, 여기선 그대로 모으기만 한다.
  const candidatesRaw = [];
  for (const [etfCode, llm] of llmByCode) {
    for (const ct of llm.candidateTags || []) candidatesRaw.push({ etfCode, ...ct });
  }
  writeJsonCache(OUT_CANDIDATES_RAW, { generatedAt: new Date().toISOString(), count: candidatesRaw.length, candidates: candidatesRaw });

  // 최종 병합: 동일 tagId는 하나로, 규칙(score=1,confidence=1) 우선 보존, LLM이 더 풍부한 evidence 추가 가능.
  const allCodes = new Set([...ruleByCode.keys(), ...llmByCode.keys()]);
  const finalEtfs = {};
  const conflicts = [];

  for (const etfCode of allCodes) {
    const rule = ruleByCode.get(etfCode);
    const llm = llmByCode.get(etfCode);
    const byTag = new Map();

    for (const c of rule?.classifications || []) {
      byTag.set(c.tagId, { ...c, mergedFrom: ['rule'] });
    }
    for (const c of llm?.classifications || []) {
      const existing = byTag.get(c.tagId);
      if (!existing) {
        byTag.set(c.tagId, { ...c, mergedFrom: ['claude_subagent'] });
      } else if (existing.mergedFrom.includes('rule') && existing.score === 1 && existing.confidence === 1) {
        // 규칙이 이미 명시적 사실로 확정 — LLM이 제거/왜곡 못 함(§15-4). evidence만 보강.
        existing.evidence = [...(existing.evidence || []), ...(c.evidence || [])];
        existing.mergedFrom.push('claude_subagent(evidence_only)');
        if (Math.abs(existing.score - c.score) > 0.01 || Math.abs(existing.confidence - c.confidence) > 0.01) {
          conflicts.push({
            etfCode,
            tagId: c.tagId,
            selectedValue: `rule(score=${existing.score},confidence=${existing.confidence})`,
            otherValue: `claude_subagent(score=${c.score},confidence=${c.confidence})`,
            reason: '규칙 확정치(score=1,confidence=1) 우선, LLM 값은 참고용으로만 기록',
          });
        }
      } else {
        // 동일 태그, 규칙 비확정 또는 다른 소스 — 더 높은 confidence 우선, 나머지는 충돌 기록.
        if (c.confidence > existing.confidence) {
          conflicts.push({ etfCode, tagId: c.tagId, selectedValue: `claude_subagent(${c.score}/${c.confidence})`, otherValue: `${existing.mergedFrom.join('+')}(${existing.score}/${existing.confidence})`, reason: 'confidence 높은 값 채택' });
          byTag.set(c.tagId, { ...c, mergedFrom: [...existing.mergedFrom, 'claude_subagent'] });
        } else {
          conflicts.push({ etfCode, tagId: c.tagId, selectedValue: `${existing.mergedFrom.join('+')}(${existing.score}/${existing.confidence})`, otherValue: `claude_subagent(${c.score}/${c.confidence})`, reason: 'confidence 높은 값 채택' });
        }
      }
    }

    const classifications = Array.from(byTag.values());
    finalEtfs[etfCode] = {
      etfCode,
      classifications,
      candidateTags: llm?.candidateTags || [],
      reviewIssues: llm?.reviewIssues || [],
      hasRuleContribution: !!rule?.classifications?.length,
      hasLlmContribution: !!llm,
    };
  }

  const finalOut = {
    generatedAt: new Date().toISOString(),
    taxonomyVersion: taxonomy.version || TAXONOMY_VERSION_FALLBACK,
    etfCount: Object.keys(finalEtfs).length,
    conflictCount: conflicts.length,
    conflicts,
    etfs: finalEtfs,
  };
  writeJsonCache(OUT_FINAL, finalOut);

  // 캐시(§14): 재실행 시 input hash+버전 동일하면 재사용 판단 근거.
  let cache = cacheExists(OUT_CACHE) ? readJsonCache(OUT_CACHE) : { entries: {} };
  for (const e of cacheEntries) cache.entries[e.etfCode] = e;
  writeJsonCache(OUT_CACHE, cache);

  console.log(`[tagging:merge] ETF ${finalOut.etfCount}종 최종 병합 (충돌 ${conflicts.length}건) → ${OUT_FINAL}`);
  console.log(`[tagging:merge] candidateTags 원본 ${candidatesRaw.length}건 → ${OUT_CANDIDATES_RAW}`);
}

main();
