// 규칙 기반 1차 분류기 — 명시적 사실만 태깅한다(§7). Claude 서브에이전트 호출 전 실행.
//   입력: data/tagging/etf-tagging-input.jsonl, config/etf-tagging/etf-tagging-rules.json, config/etf-tagging/etf-taxonomy.json
//   출력: data/tagging/etf-rule-scores.json
//   실행: npm run tagging:rules (전부 기본 경로) — --input=/--rules=/--taxonomy=/--out= 로 개별 override 가능.
//   taxonomy 는 rules 파일의 defaultFacetValues(예: asset.equity/region.domestic_kr 기본값) 적용에 쓰인다.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { readJsonCache, writeJsonCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const cliArgs = parseArgs();

const INPUT_JSONL = resolve(ROOT, cliArgs.input || 'data/tagging/etf-tagging-input.jsonl');
const RULES_FILE = resolve(ROOT, cliArgs.rules || 'config/etf-tagging/etf-tagging-rules.json');
const OUT_FILE = resolve(ROOT, cliArgs.out || 'data/tagging/etf-rule-scores.json');
const TAXONOMY_FILE = resolve(ROOT, cliArgs.taxonomy || 'config/etf-tagging/etf-taxonomy.json');

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

  const tagFacet = new Map();
  if (TAXONOMY_FILE && cacheExists(TAXONOMY_FILE)) {
    const taxonomy = readJsonCache(TAXONOMY_FILE);
    for (const t of taxonomy.tags) tagFacet.set(t.id, t.facet);
  }

  const results = [];
  let taggedCount = 0;
  for (const compact of records) {
    const classifications = [];
    const byTagId = new Map();
    const addClassification = (tagId, score, confidence, source, evidence) => {
      if (byTagId.has(tagId)) return;
      const entry = { tagId, score, confidence, source, evidence };
      byTagId.set(tagId, entry);
      classifications.push(entry);
    };

    for (const rule of rulesConfig.tagRules) {
      const re = new RegExp(rule.pattern, rule.flags || '');
      const matchedField = rule.matchFields.find((f) => re.test(fieldValue(compact, f)));
      if (matchedField) {
        addClassification(rule.tagId, rule.score, rule.confidence, 'rule', [
          `${matchedField}="${fieldValue(compact, matchedField)}" matched /${rule.pattern}/${rule.flags || ''}`,
        ]);
        for (const implied of rule.impliesTags || []) {
          const impliedTagId = typeof implied === 'string' ? implied : implied.tagId;
          const impliedScore = typeof implied === 'string' ? rule.score : implied.score;
          const impliedConfidence = typeof implied === 'string' ? rule.confidence : implied.confidence;
          addClassification(impliedTagId, impliedScore, impliedConfidence, 'rule-implied', [`implied by ${rule.tagId}`]);
        }
      }
    }

    // v2 전용: defaultFacetValues — 해당 facet/tagId 에 아무 규칙도 매칭되지 않았을 때만 기본값 채움(WORKPLAN §2, v1 rules 파일엔 키 자체가 없어 무영향).
    for (const def of rulesConfig.defaultFacetValues || []) {
      if (def.unlessFacet) {
        const hasFacetTag = classifications.some((c) => tagFacet.get(c.tagId) === def.unlessFacet);
        if (hasFacetTag) continue;
      }
      if (def.unlessTagId) {
        if (byTagId.has(def.unlessTagId)) continue;
      }
      addClassification(def.tagId, def.score, def.confidence, 'rule-default', [def.note || 'default fallback']);
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
