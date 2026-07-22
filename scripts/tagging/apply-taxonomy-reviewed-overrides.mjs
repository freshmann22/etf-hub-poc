import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS = 'data/reports/etf-taxonomy-human-shortlist-results-v2.json';
const SCORES = 'data/tagging/etf-tag-scores.json';
const TAXONOMY = 'config/etf-tagging/etf-taxonomy.json';

const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

export function applyReviewedOverrides({ write = false } = {}) {
  const results = read(RESULTS);
  const scores = read(SCORES);
  const taxonomy = read(TAXONOMY);
  const validTags = new Set(taxonomy.tags.map((tag) => tag.id));
  const applied = [];
  for (const item of results.items.filter((entry) => entry.review.decision === 'incorrect')) {
    if (item.review.reviewedAgainstHash !== item.contextHash) throw new Error(`검토 해시 불일치: ${item.etfCode}`);
    if (!scores.etfs[item.etfCode]) throw new Error(`점수 데이터에 ETF가 없습니다: ${item.etfCode}`);
    for (const tagId of item.review.finalTagIds) if (!validTags.has(tagId)) throw new Error(`알 수 없는 태그: ${tagId}`);
    const before = scores.etfs[item.etfCode].classifications.map((tag) => tag.tagId);
    const byId = new Map(scores.etfs[item.etfCode].classifications.map((tag) => [tag.tagId, tag]));
    const after = item.review.finalTagIds.map((tagId) => byId.get(tagId) || {
      tagId,
      score: 1,
      confidence: 1,
      source: 'accepted_ai_review',
      mergedFrom: ['accepted_ai_review'],
    });
    scores.etfs[item.etfCode].classifications = after;
    scores.etfs[item.etfCode].reviewIssues = [...(scores.etfs[item.etfCode].reviewIssues || []), {
      type: 'accepted_ai_review_override',
      artifactId: results.artifactId,
      reviewedAt: item.review.reviewedAt,
      note: item.review.note,
    }];
    applied.push({ etfCode: item.etfCode, before, after: after.map((tag) => tag.tagId) });
  }
  scores.reviewOverride = {
    artifactId: results.artifactId,
    acceptedPolicy: results.acceptedPolicy,
    reviewedAt: results.reviewedAt,
    appliedCount: applied.length,
  };
  if (write) fs.writeFileSync(path.join(ROOT, SCORES), JSON.stringify(scores, null, 2) + '\n', 'utf8');
  return { scores, applied };
}

function main() {
  const result = applyReviewedOverrides({ write: true });
  console.log(`[taxonomy-review-overrides] applied=${result.applied.length}`);
  for (const row of result.applied) console.log(`[taxonomy-review-overrides] ${row.etfCode}: ${row.before.join(',')} -> ${row.after.join(',')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
