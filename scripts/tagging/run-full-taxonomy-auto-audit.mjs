import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = Object.freeze({
  canonical: 'data/normalized/etf-metadata-v2.json',
  scores: 'data/tagging/etf-tag-scores.json',
  taxonomy: 'config/etf-tagging/etf-taxonomy.json',
  dartAudit: 'data/reports/metadata-v2/dart-lineage-audit.json',
  report: 'data/reports/etf-taxonomy-full-auto-audit-v2.json',
});
const MIXED_EXPLICIT_CODES = new Set([
  '183700','183710','284430','435420','438080','438100','447620','475080','490490','0000D0','0049K0','0019K0','0052S0','0057H0','0080X0','0089B0','0104H0','0111P0','0162Z0','0177N0','0178H0','0182S0','0183V0','0184E0','0186S0','0192S0','0203S0','0206G0','0216K0',
]);
const COMMODITY_CODES = new Set(['139320','400570','400580','400590','401590','0064K0','0172V0','0189B0']);
const EUROPE_CODES = new Set(['456250','0082F0','0102X0']);
const QUARANTINED_ASSIGNMENTS = Object.freeze([
  ['0192T0', 'sector.healthcare_bio_pharma', 'broad_top10_sector_threshold_missing'],
  ['0192T0', 'sector.ev_battery', 'broad_top10_sector_threshold_missing'],
  ['0192T0', 'sector.semiconductor', 'broad_top10_sector_threshold_missing'],
  ['487130', 'sector.ai_power_infrastructure', 'mandate_vs_holdings_threshold_missing'],
  ['157490', 'sector.game_entertainment_media', 'multi_sector_threshold_missing'],
]);

const absolute = (rel) => path.join(ROOT, rel);
const read = (rel) => JSON.parse(fs.readFileSync(absolute(rel), 'utf8'));
const atomicWrite = (rel, value) => {
  const file = absolute(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, file);
};
const text = (record) => `${record.identity.officialName || ''} ${record.product.benchmark?.name || ''}`;
const evidence = (record) => ({
  name: record.identity.officialName || null,
  benchmarkName: record.product.benchmark?.name || null,
  distributionFrequency: record.distribution.frequency || null,
  distributionSchedule: record.distribution.schedule || null,
  topHoldings: record.portfolio.holdings.slice(0, 10).map((item) => ({ name: item.name, weight: item.weight })),
});
const assetTag = (tagId) => tagId === 'asset.equity' || tagId === 'asset.bond' || tagId.startsWith('asset.bond.') || ['asset.commodity','asset.reit','asset.mixed','asset.currency'].includes(tagId);
const regionTag = (tagId) => tagId.startsWith('region.');

function replaceFacet(classifications, predicate, tagId, ruleId, now) {
  const existing = classifications.filter((item) => predicate(item.tagId));
  if (existing.length === 1 && existing[0].tagId === tagId && existing[0].source === 'full_auto_audit') return classifications;
  const insertionIndex = classifications.findIndex((item) => predicate(item.tagId));
  const retained = classifications.filter((item) => !predicate(item.tagId));
  retained.splice(insertionIndex < 0 ? retained.length : Math.min(insertionIndex, retained.length), 0, { tagId, score: 1, confidence: 1, source: 'full_auto_audit', mergedFrom: ['full_auto_audit'], evidence: [`rule=${ruleId}`, `appliedAt=${now}`] });
  return retained;
}

function addTag(classifications, tagId, ruleId, now) {
  const existing = classifications.find((item) => item.tagId === tagId);
  if (existing?.source === 'full_auto_audit' && existing.score === 1 && existing.confidence === 1) return classifications;
  const retained = classifications.filter((item) => item.tagId !== tagId);
  retained.push({ tagId, score: 1, confidence: 1, source: 'full_auto_audit', mergedFrom: ['full_auto_audit'], evidence: [`rule=${ruleId}`, `appliedAt=${now}`] });
  return retained;
}

export function buildTaxonomyAutoAudit({ canonical, scores, taxonomy, dartAudit, now = new Date().toISOString() }) {
  if (canonical.records.length !== 1141 || Object.keys(scores.etfs).length !== 1141) throw new Error('full-auto audit requires the complete 1,141 ETF universe');
  const metaByCode = new Map(canonical.records.map((record) => [record.identity.shortCode, record]));
  const validTags = new Set(taxonomy.tags.map((tag) => tag.id));
  const output = structuredClone(scores);
  const actions = [];

  const applyAction = (code, ruleId, transform) => {
    const record = metaByCode.get(code);
    const target = output.etfs[code];
    if (!record || !target) throw new Error(`audit target is missing from the complete universe: ${code}`);
    const before = target.classifications.map((item) => item.tagId);
    target.classifications = transform(target.classifications, record);
    const after = target.classifications.map((item) => item.tagId);
    if (new Set(after).size !== after.length || after.some((tagId) => !validTags.has(tagId))) throw new Error(`invalid post-audit tags: ${code}`);
    if (JSON.stringify(before) !== JSON.stringify(after)) actions.push({ etfCode: code, ruleId, before, after, evidence: evidence(record) });
    target.reviewIssues = (target.reviewIssues || []).filter((issue) => !(issue.type === 'full_auto_audit' && issue.ruleId === ruleId));
    target.reviewIssues.push({ type: 'full_auto_audit', ruleId, appliedAt: now });
  };

  const commodityPattern = /금은선물|금액티브|은액티브|금현물|은현물|골드|탄소배출권|gold|silver|precious metals|carbon futures/i;
  for (const code of COMMODITY_CODES) {
    const record = metaByCode.get(code);
    if (!commodityPattern.test(record.identity.officialName) || !commodityPattern.test(record.product.benchmark?.name || '')) continue;
    applyAction(code, 'asset_commodity_explicit_name_and_benchmark', (items) => replaceFacet(items, assetTag, 'asset.commodity', 'asset_commodity_explicit_name_and_benchmark', now));
  }

  const mixedPattern = /혼합|balanced|밸런스/i;
  for (const code of MIXED_EXPLICIT_CODES) {
    const record = metaByCode.get(code);
    if (!mixedPattern.test(text(record))) throw new Error(`mixed audit evidence disappeared: ${code}`);
    applyAction(code, 'asset_mixed_explicit_50_50', (items) => replaceFacet(items, assetTag, 'asset.mixed', 'asset_mixed_explicit_50_50', now));
  }
  applyAction('0086C0', 'asset_mixed_holdings_20pct_each', (items, record) => {
    const bondWeight = record.portfolio.holdings.filter((item) => /채|통안/i.test(item.name)).reduce((sum, item) => sum + Math.max(0, item.weight || 0), 0);
    const reitWeight = record.portfolio.holdings.filter((item) => /리츠|인프라/i.test(item.name)).reduce((sum, item) => sum + Math.max(0, item.weight || 0), 0);
    if (bondWeight < 20 || reitWeight < 20) throw new Error('0086C0 mixed holdings evidence no longer meets the 20%+20% gate');
    return replaceFacet(items, assetTag, 'asset.mixed', 'asset_mixed_holdings_20pct_each', now);
  });

  const monthlySchedule = /월\s*1회|매월\s*(?:의\s*)?(?:\d{1,2}일|마지막|말일)|월\s*지급|월지급/i;
  const annualOrQuarterly = /연\s*1회|분기|3개월|6개월/i;
  for (const record of canonical.records) {
    const schedule = record.distribution.schedule || '';
    if (record.distribution.frequency !== 'monthly' || !monthlySchedule.test(schedule) || annualOrQuarterly.test(schedule)) continue;
    applyAction(record.identity.shortCode, 'dividend_monthly_frequency_and_schedule', (items) => addTag(items, 'dividend.monthly', 'dividend_monthly_frequency_and_schedule', now));
  }

  for (const code of EUROPE_CODES) {
    const record = metaByCode.get(code);
    if (!/유럽|europe/i.test(record.identity.officialName) || !/유럽|europe|stoxx/i.test(record.product.benchmark?.name || '')) throw new Error(`Europe evidence disappeared: ${code}`);
    applyAction(code, 'region_europe_explicit_name_and_benchmark', (items) => replaceFacet(items, regionTag, 'region.developed', 'region_europe_explicit_name_and_benchmark', now));
  }
  applyAction('487950', 'region_remove_dow_jones_provider_false_positive', (items) => items.filter((item) => item.tagId !== 'region.us'));

  const belowMinimum = [];
  const tagById = new Map(taxonomy.tags.map((tag) => [tag.id, tag]));
  const population = new Map(taxonomy.tags.map((tag) => [tag.id, 0]));
  for (const [code, etf] of Object.entries(output.etfs)) {
    for (const item of etf.classifications) {
      const tag = tagById.get(item.tagId);
      population.set(item.tagId, (population.get(item.tagId) || 0) + 1);
      if (item.score < tag.minimumScore || item.confidence < tag.minimumConfidence) belowMinimum.push({ etfCode: code, tagId: item.tagId, score: item.score, confidence: item.confidence });
    }
  }
  const sparseTags = [...population].filter(([, count]) => count < 5).map(([tagId, count]) => ({ tagId, count }));
  const quarantinedAssignments = QUARANTINED_ASSIGNMENTS.map(([etfCode, tagId, reason]) => ({ etfCode, tagId, reason }));
  output.generatedAt = now;
  output.automatedFullAudit = {
    schemaVersion: 'taxonomy-full-auto-audit-v1',
    appliedAt: now,
    universeCount: 1141,
    actionCount: actions.length,
    affectedEtfCount: new Set(actions.map((item) => item.etfCode)).size,
    quarantinedAssignments,
    dartLineageAudit: { schemaVersion: dartAudit.schemaVersion, highRiskRecordCount: dartAudit.summary.severityCounts.high },
  };
  const report = {
    schemaVersion: 'taxonomy-full-auto-audit-v1',
    generatedAt: now,
    policy: ['고신뢰 규칙은 자동 반영', '근거 임계값이 없는 태그는 필터에서 자동 격리', 'taxonomy 공백은 넓은 대체 태그로 추측하지 않음', '두 번째 실행에서 태그 결과가 같아야 함'],
    summary: { universeCount: 1141, actionCount: actions.length, affectedEtfCount: output.automatedFullAudit.affectedEtfCount, belowMinimumCount: belowMinimum.length, sparseTagCount: sparseTags.length, quarantinedAssignmentCount: quarantinedAssignments.length },
    actions,
    quarantinedAssignments,
    reviewOnly: {
      belowMinimum,
      sparseTags,
      taxonomyGaps: [
        { etfCode: '487950', gap: 'Taiwan region tag missing' },
        { etfCode: '265690', gap: 'Russia region tag missing' },
        { etfCode: '316300', gap: 'Singapore single-country region tag missing' },
        { scope: 'dividend', gap: 'global high-dividend tag missing' },
      ],
    },
  };
  return { output, report };
}

export function run({ apply = false, now = new Date().toISOString() } = {}) {
  const result = buildTaxonomyAutoAudit({ canonical: read(FILES.canonical), scores: read(FILES.scores), taxonomy: read(FILES.taxonomy), dartAudit: read(FILES.dartAudit), now });
  const changed = result.report.actions.length > 0;
  atomicWrite(FILES.report, { ...result.report, application: { applied: apply && changed, noop: apply && !changed } });
  if (apply && changed) atomicWrite(FILES.scores, result.output);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const result = run({ apply: process.argv.includes('--apply') });
  console.log(`[taxonomy-full-auto-audit] ${JSON.stringify(result.report.summary)} apply=${process.argv.includes('--apply')}`);
}
