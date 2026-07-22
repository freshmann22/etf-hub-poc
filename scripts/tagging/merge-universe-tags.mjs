// data/tagging/etf-universe-rule-scores.json(메타데이터 미커버 671종, 이름/기초지수명 규칙태깅) 를
// canonical etf-tag-scores.json(기존 470종)에 "추가"한다. 기존 470종 항목은 건드리지 않는다(이미
// worker+rule로 검증된 sector/strategy/dividend 를 보존). primary facet(assetClass/region) cardinality는
// build-v2-tag-scores.mjs 와 동일 원칙(동일 facet 복수 매칭 시 최고 score/confidence 하나만 유지) 적용.
//   실행: node scripts/tagging/merge-universe-tags.mjs
//   출력: data/tagging/etf-tag-scores.json 갱신(470→최대 1,141종)
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonCache, writeJsonCache } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TAG_SCORES_FILE = resolve(ROOT, 'data/tagging/etf-tag-scores.json');
const UNIVERSE_RULE_SCORES_FILE = resolve(ROOT, 'data/tagging/etf-universe-rule-scores.json');
const TAXONOMY_FILE = resolve(ROOT, 'config/etf-tagging/etf-taxonomy.json');

function main() {
  const tagScores = readJsonCache(TAG_SCORES_FILE);
  const universe = readJsonCache(UNIVERSE_RULE_SCORES_FILE);
  const taxonomy = readJsonCache(TAXONOMY_FILE);
  const facetOf = new Map(taxonomy.tags.map((t) => [t.id, t.facet]));
  const parentOf = new Map(taxonomy.tags.map((t) => [t.id, t.parent]));

  let added = 0;
  let skippedExisting = 0;
  for (const r of universe.results) {
    if (tagScores.etfs[r.etfCode]) {
      skippedExisting++;
      continue; // 이미 470종에 있으면(메타데이터 커버) 건드리지 않음
    }
    if (!r.classifications.length) continue;

    // primary facet(assetClass/region) cardinality 정리 — 최고 score/confidence 하나만 유지.
    const classifications = r.classifications.map((c) => ({ ...c, mergedFrom: [c.source] }));
    for (const facet of ['assetClass', 'region']) {
      const primaryTags = classifications.filter((c) => facetOf.get(c.tagId) === facet && parentOf.get(c.tagId) === null);
      if (primaryTags.length <= 1) continue;
      const winner = primaryTags.slice().sort((a, b) => b.score - a.score || b.confidence - a.confidence)[0];
      for (const loser of primaryTags) {
        if (loser === winner) continue;
        const idx = classifications.indexOf(loser);
        classifications.splice(idx, 1);
      }
    }

    tagScores.etfs[r.etfCode] = {
      etfCode: r.etfCode,
      classifications,
      candidateTags: [],
      reviewIssues: [],
      hasRuleContribution: true,
      hasLlmContribution: false,
    };
    added++;
  }

  tagScores.generatedAt = new Date().toISOString();
  tagScores.etfCount = Object.keys(tagScores.etfs).length;
  tagScores.universeExpansionNote = `메타데이터 미커버 ETF ${added}종을 이름/기초지수명 규칙태깅(assetClass/region/일부 strategy)으로 추가. 구성종목 없어 sector 태그는 미부여. 기존 ${skippedExisting}종(메타데이터 커버, worker 스코어링 포함)은 무변경.`;
  writeJsonCache(TAG_SCORES_FILE, tagScores);
  console.log(`[universe-merge] 신규 ${added}종 추가, 기존 ${skippedExisting}종 유지 → ETF 총 ${tagScores.etfCount}종`);
}

main();
