// 최종 병합 결과 → UI용 filter map + low-confidence/unclassified 목록 생성(§15-6,7 / §17).
//   입력: data/tagging/etf-tag-scores.json, config/etf-tagging/etf-taxonomy.json
//   출력: data/tagging/etf-filter-map.json, data/tagging/etf-low-confidence.json, data/tagging/etf-unclassified.json
//   실행: npm run tagging:merge 이후 자동 호출(또는 node scripts/tagging/build-filter-map.mjs)
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonCache, writeJsonCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TAG_SCORES_FILE = resolve(ROOT, 'data/tagging/etf-tag-scores.json');
const TAXONOMY_FILE = resolve(ROOT, 'config/etf-tagging/etf-taxonomy.json');
const OUT_FILTER_MAP = resolve(ROOT, 'data/tagging/etf-filter-map.json');
const OUT_LOW_CONFIDENCE = resolve(ROOT, 'data/tagging/etf-low-confidence.json');
const OUT_UNCLASSIFIED = resolve(ROOT, 'data/tagging/etf-unclassified.json');

function main() {
  if (!cacheExists(TAG_SCORES_FILE)) throw new Error('먼저 npm run tagging:merge 를 실행하세요.');
  const tagScores = readJsonCache(TAG_SCORES_FILE);
  const taxonomy = readJsonCache(TAXONOMY_FILE);
  const taxonomyMap = new Map(taxonomy.tags.map((t) => [t.id, t]));

  const filters = {}; // tagId -> [{etfCode, score, confidence}]
  const lowConfidence = []; // {etfCode, tagId, score, confidence, reason}
  const unclassified = []; // {etfCode, reason}
  const etfsOut = {};

  for (const [etfCode, etf] of Object.entries(tagScores.etfs)) {
    const passingTags = [];
    for (const c of etf.classifications) {
      const tag = taxonomyMap.get(c.tagId);
      if (!tag || !tag.enabled) continue;
      if (c.score >= tag.minimumScore && c.confidence >= tag.minimumConfidence) {
        passingTags.push({ tagId: c.tagId, score: c.score, confidence: c.confidence });
        if (!filters[c.tagId]) filters[c.tagId] = [];
        filters[c.tagId].push({ etfCode, score: c.score, confidence: c.confidence });
      } else {
        lowConfidence.push({
          etfCode,
          tagId: c.tagId,
          score: c.score,
          confidence: c.confidence,
          reason: `minimumScore=${tag.minimumScore}/minimumConfidence=${tag.minimumConfidence} 미달`,
        });
      }
    }
    if (passingTags.length) {
      etfsOut[etfCode] = { tags: passingTags };
    } else {
      unclassified.push({
        etfCode,
        reason: etf.classifications.length
          ? '모든 분류가 minimumScore/minimumConfidence 미달(low-confidence로 분리됨)'
          : (etf.hasLlmContribution ? 'Claude 서브에이전트 판단 결과 관련 태그 없음(관련성 약함)' : '아직 Claude 서브에이전트로 스코어링되지 않음(규칙 매칭도 없음)'),
      });
    }
  }

  for (const tagId of Object.keys(filters)) {
    filters[tagId].sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.etfCode.localeCompare(b.etfCode));
  }

  const filterMap = {
    generatedAt: new Date().toISOString(),
    taxonomyVersion: tagScores.taxonomyVersion,
    filters,
    etfs: etfsOut,
  };
  writeJsonCache(OUT_FILTER_MAP, filterMap);
  writeJsonCache(OUT_LOW_CONFIDENCE, { generatedAt: new Date().toISOString(), count: lowConfidence.length, items: lowConfidence });
  writeJsonCache(OUT_UNCLASSIFIED, { generatedAt: new Date().toISOString(), count: unclassified.length, items: unclassified });

  console.log(`[tagging:filter-map] 필터 ${Object.keys(filters).length}개, 태그 부여 ETF ${Object.keys(etfsOut).length}종 → ${OUT_FILTER_MAP}`);
  console.log(`[tagging:filter-map] low-confidence ${lowConfidence.length}건, unclassified ${unclassified.length}종`);
}

main();
