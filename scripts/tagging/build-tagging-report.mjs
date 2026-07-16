// 최종 리포트 생성(§16, §21). 사람이 읽는 요약 + 충돌 CSV + 샘플 리뷰 요약.
//   실행: npm run tagging:report
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonCache, writeCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TAG_SCORES_FILE = resolve(ROOT, 'data/tagging/etf-tag-scores.json');
const FILTER_MAP_FILE = resolve(ROOT, 'data/tagging/etf-filter-map.json');
const LOW_CONF_FILE = resolve(ROOT, 'data/tagging/etf-low-confidence.json');
const UNCLASSIFIED_FILE = resolve(ROOT, 'data/tagging/etf-unclassified.json');
const CANDIDATES_FILE = resolve(ROOT, 'data/tagging/etf-filter-candidates.json');
const RULE_SCORES_FILE = resolve(ROOT, 'data/tagging/etf-rule-scores.json');
const OUT_SUMMARY = resolve(ROOT, 'reports/tagging/etf-tagging-summary.md');
const OUT_CONFLICTS_CSV = resolve(ROOT, 'reports/tagging/etf-tagging-conflicts.csv');
const OUT_SAMPLE_REVIEW = resolve(ROOT, 'reports/tagging/etf-tagging-sample-review.md');

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function main() {
  if (!cacheExists(TAG_SCORES_FILE)) throw new Error('먼저 npm run tagging:merge 를 실행하세요.');
  const tagScores = readJsonCache(TAG_SCORES_FILE);
  const filterMap = cacheExists(FILTER_MAP_FILE) ? readJsonCache(FILTER_MAP_FILE) : { filters: {}, etfs: {} };
  const lowConf = cacheExists(LOW_CONF_FILE) ? readJsonCache(LOW_CONF_FILE) : { count: 0, items: [] };
  const unclassified = cacheExists(UNCLASSIFIED_FILE) ? readJsonCache(UNCLASSIFIED_FILE) : { count: 0, items: [] };
  const candidates = cacheExists(CANDIDATES_FILE) ? readJsonCache(CANDIDATES_FILE) : { candidates: [] };
  const ruleScores = cacheExists(RULE_SCORES_FILE) ? readJsonCache(RULE_SCORES_FILE) : { recordCount: 0, taggedByRuleCount: 0 };

  const llmScoredCount = Object.values(tagScores.etfs).filter((e) => e.hasLlmContribution).length;

  const filterRows = Object.entries(filterMap.filters || {})
    .map(([tagId, etfs]) => `| ${tagId} | ${etfs.length} |`)
    .join('\n');

  const summary = `# ETF 태깅 요약

생성 시각: ${new Date().toISOString()}
taxonomy version: ${tagScores.taxonomyVersion}

## 규모
- 규칙 분류기 처리 ETF: ${ruleScores.recordCount}종 (규칙으로 태그 부여됨: ${ruleScores.taggedByRuleCount}종)
- Claude 서브에이전트 스코어링 완료 ETF: ${llmScoredCount}종
- 병합 최종 레코드: ${tagScores.etfCount}종 (병합 충돌 ${tagScores.conflictCount}건)

## UI 필터 매핑
- 활성 필터 수(minimumScore/minimumConfidence 통과): ${Object.keys(filterMap.filters || {}).length}
- 태그가 하나 이상 부여된 ETF: ${Object.keys(filterMap.etfs || {}).length}종

| tagId | 매칭 ETF 수 |
|---|---|
${filterRows || '| (없음) | 0 |'}

## 저신뢰/미분류
- low-confidence 분류: ${lowConf.count}건
- unclassified ETF: ${unclassified.count}종

## 신규 필터 후보
${(candidates.candidates || []).map((c) => `- \`${c.candidateId}\`(${c.label}, ${c.suggestedCategory}) — 매칭 ${c.matchedEtfCount}종, 평균 score ${c.averageScore}, 평균 confidence ${c.averageConfidence} → **${c.recommendation}**`).join('\n') || '- (없음)'}
`;
  writeCache(OUT_SUMMARY, summary);

  const conflictRows = (tagScores.conflicts || [])
    .map((c) => [c.etfCode, c.tagId, c.selectedValue, c.otherValue, c.reason].map(csvEscape).join(','));
  writeCache(OUT_CONFLICTS_CSV, ['etfCode,tagId,selectedValue,otherValue,reason', ...conflictRows].join('\n') + '\n');

  const sampleReviewLines = ['# 샘플 스코어링 리뷰 요약\n'];
  for (const [etfCode, etf] of Object.entries(tagScores.etfs)) {
    if (!etf.hasLlmContribution) continue;
    const tags = etf.classifications.map((c) => `${c.tagId}(${c.score}/${c.confidence})`).join(', ') || '(태그 없음)';
    const issues = etf.reviewIssues?.length ? etf.reviewIssues.map((i) => `${i.tagId ?? ''}:${i.detail}`).join(' | ') : '(리뷰 이슈 없음)';
    sampleReviewLines.push(`## ${etfCode}\n- 태그: ${tags}\n- 리뷰 이슈: ${issues}\n`);
  }
  writeCache(OUT_SAMPLE_REVIEW, sampleReviewLines.join('\n'));

  console.log(`[tagging:report] → ${OUT_SUMMARY}`);
  console.log(`[tagging:report] → ${OUT_CONFLICTS_CSV}`);
  console.log(`[tagging:report] → ${OUT_SAMPLE_REVIEW}`);
}

main();
