// Summary generation: assembles the tag_brief output schema (§4 of the
// session brief) from a TagUniverse + its assigned articles, and enforces
// the "insufficient data -> unpublished" / "policy gate fail twice ->
// unpublished" rules. Pure orchestration only — the actual summary text
// comes from `contentProvider`, an injected function so this module has no
// hard dependency on any specific LLM client. When no live model call is
// available, the build script passes a contentProvider that returns
// hand-authored Korean text and stamps generator: 'manual-sample'.

import { validateBrief } from './policyGate.js';

export const MIN_ARTICLES_TO_PUBLISH = 2;
export const MAX_GENERATION_ATTEMPTS = 2;

// Pinned into the system prompt for any real generation call.
export const SYSTEM_PROMPT_RULES = [
  '입력으로 제공된 기사에 없는 숫자, 사실, 종목, 지수는 절대 언급하지 마세요.',
  '판단·유인 표현(추천, 지금 사야, 매수/매도 타이밍, 목표가, 자금 유입, 유망, 기회, 주목할 만, 좋다/유리하다/개선 기대 등)과 ' +
    '행동 유도 표현(대비해야, 고려할 만 등)을 쓰지 마세요.',
  '증가했다/집중됐다/발표했다/하락 마감했다 같은 서술적 표현만 사용하세요.',
  'summary는 특정 회사명·계약 내용 등 구체적 사실을 나열하지 않는 30자 이내의 일반적인 한 줄 요약이어야 합니다 ' +
    '(가능하면 핵심 키워드 하나는 유지하되, 세부 근거는 keyPoints에 담으세요).',
  'keyPoints는 근거 기사에 기반한 구체적 사실 2~3개를 불릿으로 담으세요.',
  '존댓말 해설형(정중한 설명체)의 한국어로, JSON만 출력하세요.',
];

function buildBriefId(tagId, briefDate) {
  return `tag-brief-${tagId}-${briefDate.replace(/-/g, '')}`;
}

// Assembles one tag_brief object per the §4 output schema. `content` is
// { title, summary, keyPoints, mentionedStockIds, mentionedTopicIds } —
// the part a generator (human or model) is responsible for producing.
export function assembleBrief({ tagUniverse, articles, briefDate, taxonomyVersion, content, generatedAt, generator }) {
  return {
    id: buildBriefId(tagUniverse.tagId, briefDate),
    type: 'tag_brief',
    tagId: tagUniverse.tagId,
    tagCategory: tagUniverse.tagCategory,
    briefDate,
    title: content.title,
    summary: content.summary,
    keyPoints: content.keyPoints,
    sourceArticles: articles.map((article) => ({
      id: article.id,
      title: article.title,
      source: article.source,
      publishedAt: article.publishedAt,
    })),
    relatedEtfIds: tagUniverse.etfIds,
    mentionedStockIds: content.mentionedStockIds,
    mentionedTopicIds: content.mentionedTopicIds,
    taxonomyVersion,
    universeSnapshot: {
      stockCount: tagUniverse.stockIds.length,
      etfCount: tagUniverse.etfIds.length,
      provisional: tagUniverse.provisional,
    },
    generatedAt,
    generator,
  };
}

// Generates (or declines to generate) one tag_brief for a tag. Never pads
// thin data: fewer than MIN_ARTICLES_TO_PUBLISH assigned articles means the
// tag is marked unpublished instead of producing a brief. If the assembled
// brief fails the policy gate, contentProvider is retried once; a second
// failure also marks the tag unpublished (never ships a briefing that
// failed validation).
export function generateBrief({ tagUniverse, articles, briefDate, taxonomyVersion, generatedAt, generator, contentProvider }) {
  if (articles.length < MIN_ARTICLES_TO_PUBLISH) {
    return {
      tagId: tagUniverse.tagId,
      briefDate,
      unpublished: true,
      reason: 'insufficient_articles',
      articleCount: articles.length,
    };
  }

  let lastViolations = [];
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const content = contentProvider(attempt);
    const brief = assembleBrief({ tagUniverse, articles, briefDate, taxonomyVersion, content, generatedAt, generator });
    const { valid, violations } = validateBrief(brief, articles);
    if (valid) return brief;
    lastViolations = violations;
  }

  return {
    tagId: tagUniverse.tagId,
    briefDate,
    unpublished: true,
    reason: 'policy_gate_failed',
    violations: lastViolations,
  };
}

// Live providers are asynchronous. Keep the synchronous function above for
// deterministic fixture/tests, and expose the same policy contract for API clients.
export async function generateBriefAsync({ tagUniverse, articles, briefDate, taxonomyVersion, generatedAt, generator, contentProvider }) {
  if (articles.length < MIN_ARTICLES_TO_PUBLISH) {
    return {
      tagId: tagUniverse.tagId,
      briefDate,
      unpublished: true,
      reason: 'insufficient_articles',
      articleCount: articles.length,
    };
  }

  let lastViolations = [];
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const content = await contentProvider(attempt);
    const brief = assembleBrief({ tagUniverse, articles, briefDate, taxonomyVersion, content, generatedAt, generator });
    const { valid, violations } = validateBrief(brief, articles);
    if (valid) return brief;
    lastViolations = violations;
  }

  return {
    tagId: tagUniverse.tagId,
    briefDate,
    unpublished: true,
    reason: 'policy_gate_failed',
    violations: lastViolations,
  };
}
