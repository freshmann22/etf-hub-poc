// Policy validation gate for generated tag_brief content. Pure functions
// only; no DOM/network/taxonomy access. Applies to every AI-generated
// briefing before it is allowed into data/fixtures/tag-briefs.json.

// Superset of tests/content-policy.test.mjs's forbidden-substring list, plus
// the additional inducement/judgment/action-prompting families called out in
// this session's brief (§2). Kept here (not imported from the test file) so
// this module has no dependency on tests/.
export const FORBIDDEN_PHRASES = [
  '추천 ETF',
  'ETF 추천',
  '추천 테마',
  '추천드',
  '추천합니다',
  '지금 사야',
  '매수 타이밍',
  '매도 타이밍',
  '상승 가능성이 높',
  '목표가격',
  '목표수익률',
  '목표가',
  '자금 유입',
  '자금이 유입',
  '자금이 몰',
  '돈이 몰',
  '자금이 빠져',
  '유망',
  '투자 기회',
  '매수 기회',
  '주목할 만',
  '대비해야',
  '고려할 만',
  '고려해볼',
  '지금이 적기',
  '사야 할',
  '팔아야 할',
];

function findForbiddenPhrases(text) {
  return FORBIDDEN_PHRASES.filter((phrase) => text.includes(phrase));
}

// summary is a short, general one-liner (card headline), not a 3-4 sentence
// detailed recap — the detailed, evidence-specific facts belong in keyPoints.
export const MAX_SUMMARY_LENGTH = 30;

// Validates one assembled tag_brief object against the article set it was
// generated from. Returns { valid: boolean, violations: string[] }.
export function validateBrief(brief, inputArticles) {
  const violations = [];

  if (typeof brief.summary === 'string' && brief.summary.length > MAX_SUMMARY_LENGTH) {
    violations.push(`summary_too_long:${brief.summary.length}`);
  }

  const textFields = [brief.title, brief.summary, ...(brief.keyPoints || [])].filter(Boolean);
  for (const text of textFields) {
    for (const phrase of findForbiddenPhrases(text)) {
      violations.push(`forbidden_phrase:${phrase}`);
    }
  }

  const inputArticleIds = new Set(inputArticles.map((article) => article.id));
  for (const sourceArticle of brief.sourceArticles || []) {
    if (!inputArticleIds.has(sourceArticle.id)) {
      violations.push(`unknown_source_article:${sourceArticle.id}`);
    }
  }

  const inputStockIds = new Set(inputArticles.flatMap((article) => article.mentionedStockIds));
  for (const stockId of brief.mentionedStockIds || []) {
    if (!inputStockIds.has(stockId)) violations.push(`unsupported_stock_id:${stockId}`);
  }

  const inputTopicIds = new Set(inputArticles.flatMap((article) => article.mentionedTopicIds));
  for (const topicId of brief.mentionedTopicIds || []) {
    if (!inputTopicIds.has(topicId)) violations.push(`unsupported_topic_id:${topicId}`);
  }

  return { valid: violations.length === 0, violations };
}
