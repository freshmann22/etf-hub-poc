// 규칙 기반 1차 분류기 — 명시적 사실만 태깅한다(§7). Claude 서브에이전트 호출 전 실행.
//   입력: data/tagging/etf-tagging-input.jsonl, config/etf-tagging/etf-tagging-rules.json
//   출력: data/tagging/etf-rule-scores.json
//   실행: npm run tagging:rules
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { readJsonCache, writeJsonCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INPUT_JSONL = resolve(ROOT, 'data/tagging/etf-tagging-input.jsonl');
const RULES_FILE = resolve(ROOT, 'config/etf-tagging/etf-tagging-rules.json');
const OUT_FILE = resolve(ROOT, 'data/tagging/etf-rule-scores.json');

function loadJsonl(path) {
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim().length)
    .map((l) => JSON.parse(l));
}

function fieldValue(compact, fieldName) {
  switch (fieldName) {
    case 'name':
      return compact.name || '';
    case 'benchmarkName':
      return compact.benchmark?.name || '';
    case 'distributionScheduleText':
      return compact.distribution?.scheduleText || '';
    default:
      return '';
  }
}

function main() {
  if (!cacheExists(INPUT_JSONL)) throw new Error('먼저 npm run tagging:prepare 를 실행하세요.');
  const rulesConfig = readJsonCache(RULES_FILE);
  const records = loadJsonl(INPUT_JSONL);

  const results = [];
  let taggedCount = 0;
  for (const compact of records) {
    const classifications = [];
    for (const rule of rulesConfig.tagRules) {
      const re = new RegExp(rule.pattern, rule.flags || '');
      const matchedField = rule.matchFields.find((f) => re.test(fieldValue(compact, f)));
      if (matchedField) {
        classifications.push({
          tagId: rule.tagId,
          score: rule.score,
          confidence: rule.confidence,
          source: 'rule',
          evidence: [`${matchedField}="${fieldValue(compact, matchedField)}" matched /${rule.pattern}/${rule.flags || ''}`],
        });
      }
    }
    // factRules(참고용, taxonomy 태그 아님) — classificationFacts.nameHints 를 그대로 반영.
    const facts = {
      active: compact.facts?.active ?? null,
      currencyHedged: compact.facts?.currencyHedged ?? null,
      nameHints: compact.facts?.nameHints ?? [],
    };
    if (classifications.length) taggedCount++;
    results.push({ etfCode: compact.etfCode, name: compact.name, classifications, facts });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    rulesVersion: rulesConfig.version,
    recordCount: results.length,
    taggedByRuleCount: taggedCount,
    results,
  };
  writeJsonCache(OUT_FILE, out);
  console.log(`[tagging:rules] ${results.length}종 중 규칙으로 태그 부여된 ETF ${taggedCount}종 → ${OUT_FILE}`);
}

main();
