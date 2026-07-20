// 이미 사람/감사자가 검토한 canonical 분류를 보존하면서, 새로 연결된 공공데이터
// 기초지수명에서 확정적으로 매칭된 benchmark 태그만 증분 병합한다.
// 일반 merge-scores는 원시 배치부터 재생성하므로 auditor 승격 결과를 덮을 수 있다.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonCache, writeJsonCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TAG_SCORES_FILE = resolve(ROOT, 'data/tagging/etf-tag-scores.json');
const RULE_SCORES_FILE = resolve(ROOT, 'data/tagging/etf-rule-scores.json');
const TAXONOMY_FILE = resolve(ROOT, 'config/etf-tagging/etf-taxonomy.json');

function main() {
  for (const file of [TAG_SCORES_FILE, RULE_SCORES_FILE, TAXONOMY_FILE]) {
    if (!cacheExists(file)) throw new Error(`필수 파일 없음: ${file}`);
  }
  const canonical = readJsonCache(TAG_SCORES_FILE);
  const rules = readJsonCache(RULE_SCORES_FILE);
  const taxonomy = readJsonCache(TAXONOMY_FILE);
  const validBenchmarkTags = new Set(taxonomy.tags.filter((tag) => tag.enabled && tag.id.startsWith('strategy.benchmark.')).map((tag) => tag.id));
  let added = 0;
  const additions = [];

  for (const result of rules.results) {
    const target = canonical.etfs[result.etfCode];
    if (!target) continue;
    const existing = new Set(target.classifications.map((item) => item.tagId));
    for (const classification of result.classifications) {
      const hasBenchmarkEvidence = (classification.evidence || []).some((line) => line.startsWith('benchmarkName='));
      if (!validBenchmarkTags.has(classification.tagId) || !hasBenchmarkEvidence || existing.has(classification.tagId)) continue;
      target.classifications.push({
        ...classification,
        mergedFrom: [...new Set([...(classification.mergedFrom || []), 'publicdata_benchmark_enrichment'])],
      });
      existing.add(classification.tagId);
      additions.push({ etfCode: result.etfCode, tagId: classification.tagId, evidence: classification.evidence });
      added++;
    }
  }

  canonical.generatedAt = new Date().toISOString();
  canonical.taxonomyVersion = taxonomy.version;
  canonical.benchmarkEnrichment = {
    appliedAt: canonical.generatedAt,
    source: 'data/tagging/etf-universe-index-names.json',
    addedCount: added,
    additions,
    note: '기존 검토·auditor 승격 분류는 보존하고 공공데이터 기초지수명에서 규칙으로 확정된 benchmark 태그만 추가',
  };
  writeJsonCache(TAG_SCORES_FILE, canonical);
  console.log(`[benchmark-enrichment] canonical 보존, benchmark 태그 ${added}건 추가 → ${TAG_SCORES_FILE}`);
}

main();
