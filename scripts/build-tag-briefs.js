// Batch generation script for the tag_brief content type.
//
// This environment has no live LLM API wired up for this pipeline, so per
// the session brief's fallback instruction, generation content below is
// hand-authored (by the Claude Code session) rather than produced by an
// automated model call, and every output brief is honestly stamped
// generator: 'manual-sample'. The pipeline shape (universe -> assign ->
// generate -> policy gate -> fixture) is otherwise exactly what an
// automated run would go through: swap MANUAL_CONTENT_BY_TAG for a real
// contentProvider(attempt) that calls a model, and nothing else changes.
//
// Usage: node scripts/build-tag-briefs.js

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildTagUniverses, getTaxonomyVersion } from '../src/js/tag-brief/universeAdapter.js';
import { assignArticles, validateTopicRegistry } from '../src/js/tag-brief/assign.js';
import { generateBrief } from '../src/js/tag-brief/generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const NEWS_PATH = path.join(REPO_ROOT, 'data', 'fixtures', 'news-articles.json');
const TOPIC_REGISTRY_PATH = path.join(REPO_ROOT, 'data', 'fixtures', 'topic-registry.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'fixtures', 'tag-briefs.json');

const BRIEF_DATE = '2026-07-16';
const GENERATED_AT = '2026-07-16T09:00:00+09:00';
const GENERATOR = 'manual-sample';

// Hand-authored per-tag content. Every number/fact/stock/topic used here was
// checked by hand against that tag's assigned articles before being written
// (the policy gate re-checks this mechanically at generation time too).
const MANUAL_CONTENT_BY_TAG = {
  'sector.semiconductor': {
    title: '반도체 브리핑',
    summary: 'HBM·파운드리 수주 소식이 이어졌어요.',
    keyPoints: [
      'SK하이닉스와 삼성전자가 각각 HBM 공급 계약과 파운드리 신규 수주 계약을 체결했어요.',
      '메모리 반도체 현물가격 상승과 함께 관련 ETF 거래대금이 증가했어요.',
      '한미반도체·원익IPS 등 반도체 장비주에서도 수주·출하량 증가 소식이 있었어요.',
    ],
    mentionedStockIds: ['000660', '005930', '042700', '240810'],
    mentionedTopicIds: [],
  },
  'sector.aerospace_defense': {
    title: '방산/항공우주 브리핑',
    summary: '방산 수출·수주 계약 소식이 이어졌어요.',
    keyPoints: [
      '한화에어로스페이스·한국항공우주가 해외向 방산 수출 계약을 체결했어요.',
      '한화오션은 특수선 건조 계약과 함정 유지보수 계약을 함께 체결했어요.',
    ],
    mentionedStockIds: ['012450', '047810', '042660'],
    mentionedTopicIds: [],
  },
  'sector.ev_battery': {
    title: '2차전지 브리핑',
    summary: '2차전지 공급·소재 소식이 엇갈렸어요.',
    keyPoints: [
      'LG에너지솔루션이 북미向 배터리 공급 계약을 체결했어요.',
      '에코프로비엠 양극재 출하량은 늘었지만 리튬 등 소재 가격은 하락세를 이어갔어요.',
    ],
    mentionedStockIds: ['373220', '247540', '051910', '086520'],
    mentionedTopicIds: [],
  },
  'sector.shipbuilding': {
    title: '조선/조선기자재 브리핑',
    summary: '조선 수주잔고 확대 소식이 있었어요.',
    keyPoints: [
      'HD현대중공업·삼성중공업이 각각 대형 선박, 해양플랜트 수주를 발표했어요.',
      'HD한국조선해양의 수주잔고와 신조선가 지수가 함께 상승했어요.',
      '한화오션은 특수선 건조·함정 유지보수 계약을 동시에 체결했어요.',
    ],
    mentionedStockIds: ['329180', '010140', '009540', '443060', '042660'],
    mentionedTopicIds: [],
  },
  'strategy.benchmark.sp500': {
    title: 'S&P500 브리핑',
    summary: 'S&P500 지수 등락 소식이 있었어요.',
    keyPoints: [
      'S&P500은 기술주 강세와 금리 동결 발표에 각각 상승 마감했어요.',
      '이후 미 국채 금리 상승과 함께 S&P500이 하락 마감했어요.',
      '같은 기간 국내 국고채 금리 상승과 크레딧 스프레드 확대가 함께 나타났어요.',
    ],
    mentionedStockIds: [],
    mentionedTopicIds: ['topic.us_index', 'topic.rates', 'topic.credit'],
  },
  'asset.bond': {
    title: '채권 브리핑',
    summary: '국내외 채권금리·크레딧 소식이 있었어요.',
    keyPoints: [
      '국내 국고채 금리 상승과 크레딧 스프레드 확대가 함께 나타났어요.',
      '회사채 발행 규모는 늘었지만 크레딧 스프레드는 큰 변화 없이 유지됐어요.',
      '미 연준의 금리 동결과 미 국채 금리 상승 소식이 함께 전해졌어요.',
    ],
    mentionedStockIds: [],
    mentionedTopicIds: ['topic.rates', 'topic.credit', 'topic.us_index'],
  },
};

function main() {
  const articles = JSON.parse(readFileSync(NEWS_PATH, 'utf8')).articles;
  const registry = JSON.parse(readFileSync(TOPIC_REGISTRY_PATH, 'utf8'));

  const registryViolations = validateTopicRegistry(articles, registry);
  if (registryViolations.length > 0) {
    throw new Error('news-articles.json uses unregistered topic ids: ' + JSON.stringify(registryViolations));
  }

  const universes = buildTagUniverses();
  const taxonomyVersion = getTaxonomyVersion();
  const { byTag, unassigned } = assignArticles(articles, universes);

  const briefs = [];
  const unpublished = [];

  for (const [tagId, universe] of universes) {
    const assignedArticles = byTag.get(tagId) || [];
    const manualContent = MANUAL_CONTENT_BY_TAG[tagId];
    if (!manualContent) throw new Error('no manual content authored for tag: ' + tagId);

    const result = generateBrief({
      tagUniverse: universe,
      articles: assignedArticles,
      briefDate: BRIEF_DATE,
      taxonomyVersion,
      generatedAt: GENERATED_AT,
      generator: GENERATOR,
      contentProvider: () => manualContent,
    });

    if (result.unpublished) {
      unpublished.push(result);
      console.log(`[unpublished] ${tagId}: ${result.reason} (articleCount=${result.articleCount ?? assignedArticles.length})`);
    } else {
      briefs.push(result);
      console.log(`[published]   ${tagId}: ${assignedArticles.length} source articles`);
    }
  }

  const output = {
    generatedAt: GENERATED_AT,
    briefDate: BRIEF_DATE,
    taxonomyVersion,
    briefs,
    unpublished,
    unassignedArticleIds: unassigned.map((article) => article.id),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ${briefs.length} brief(s), ${unpublished.length} unpublished, ${unassigned.length} unassigned article(s) -> ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
}

main();
