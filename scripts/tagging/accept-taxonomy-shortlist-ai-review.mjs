import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INPUT = 'data/reports/etf-taxonomy-human-shortlist-v2.json';
const OUTPUT_JSON = 'data/reports/etf-taxonomy-human-shortlist-results-v2.json';
const OUTPUT_CSV = 'reports/tagging/etf-taxonomy-human-shortlist-results-v2.csv';
const REVIEWER = 'AI recommendation accepted by project owner';

const DECISIONS = {
  '0104P0': { decision: 'incorrect', remove: ['region.us'], add: ['region.domestic_kr'], note: '국내 주식 배당지수 상품이며 다우존스 명칭만으로 미국 지역을 부여한 오탐. 미국 태그를 제거하고 국내 태그를 적용.' },
  '0052D0': { decision: 'incorrect', remove: ['region.us'], add: ['region.domestic_kr'], note: '국내 주식 배당지수 상품이며 다우존스 명칭만으로 미국 지역을 부여한 오탐. 미국 태그를 제거하고 국내 태그를 적용.' },
  '490090': { decision: 'insufficient', missingEvidence: '해당 ETF 자체의 정확한 DART 첨부문서', nextAction: '493810과 공유된 PDF 계보를 분리하고 490090의 frequency 후보를 재조립', note: '월분배 값 사용 보류.' },
  '458730': { decision: 'insufficient', missingEvidence: '비커버드콜 상품과 일치하는 정확한 DART 첨부문서', nextAction: '타겟데일리커버드콜 문서 연결을 제거하고 458730의 frequency 후보를 재조립', note: '월분배 값 사용 보류.' },
  '489000': { decision: 'insufficient', missingEvidence: '공식 보유종목 및 실질 노출 근거', nextAction: '일본 엔화·초단기 국채 노출을 공식 자료로 보강', note: '현재 분류는 잠정 유지.' },
  '375270': { decision: 'insufficient', missingEvidence: '공식 보유종목 및 국가 비중', nextAction: '리츠·선진국 분류의 실질 노출 근거 보강', note: '현재 분류는 잠정 유지.' },
  '0192T0': { decision: 'insufficient', missingEvidence: '세부 섹터별 편입비중 임계값 정책', nextAction: 'TOP10 광범위 지수에 세부 섹터 태그를 허용하는 최소 비중 결정', note: '바이오·배터리·반도체 태그 확정 보류.' },
  '487130': { decision: 'insufficient', missingEvidence: 'AI 전력 인프라 태그의 최소 편입비중', nextAction: '운용목표와 실제 보유비중 중 어느 근거를 우선할지 정책 결정', note: '반도체는 유지, AI 전력 태그만 확정 보류.' },
  '157490': { decision: 'insufficient', missingEvidence: '게임·미디어 편입비중과 섹터 태그 임계값', nextAction: 'IT 하위 다중 섹터 허용 기준 결정', note: 'IT는 유지, 게임·미디어 태그만 확정 보류.' },
};

const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const write = (rel, content) => {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
};
const csv = (value) => {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function acceptAiRecommendations({ reviewedAt = new Date().toISOString() } = {}) {
  const report = read(INPUT);
  const allowed = new Set(report.allowedTagIds);
  const items = report.items.map((item) => {
    const current = item.currentClassifications.map((tag) => tag.tagId);
    const rule = DECISIONS[item.etfCode] || { decision: 'correct', note: `AI 권고 승인: ${item.aiRecommendation}` };
    const finalTagIds = rule.decision === 'incorrect'
      ? [...new Set(current.filter((id) => !(rule.remove || []).includes(id)).concat(rule.add || []))]
      : current;
    for (const tagId of finalTagIds) if (!allowed.has(tagId)) throw new Error(`알 수 없는 최종 태그: ${item.etfCode} ${tagId}`);
    return {
      ...item,
      review: {
        workflowStatus: 'reviewed',
        decision: rule.decision,
        finalTagIds,
        note: rule.note || `AI 권고 승인: ${item.aiRecommendation}`,
        missingEvidence: rule.missingEvidence || '',
        nextAction: rule.nextAction || '',
        reviewer: REVIEWER,
        reviewedAt,
        reviewedAgainstHash: item.contextHash,
      },
    };
  });
  const decisionCounts = Object.fromEntries(['correct', 'incorrect', 'insufficient'].map((decision) => [decision, items.filter((item) => item.review.decision === decision).length]));
  return { ...report, artifactId: 'taxonomy-human-shortlist-results-v2', acceptedPolicy: 'project_owner_accepted_all_ai_recommendations', reviewer: REVIEWER, reviewedAt, summary: { ...report.summary, reviewedCount: items.length, decisionCounts }, items };
}

function writeCsv(report) {
  const headers = ['shortlistNumber', 'etfCode', 'name', 'decision', 'currentTagIds', 'finalTagIds', 'note', 'missingEvidence', 'nextAction', 'reviewer', 'reviewedAt', 'reviewedAgainstHash'];
  const rows = report.items.map((item) => [item.shortlistNumber, item.etfCode, item.name, item.review.decision, item.currentClassifications.map((tag) => tag.tagId), item.review.finalTagIds, item.review.note, item.review.missingEvidence, item.review.nextAction, item.review.reviewer, item.review.reviewedAt, item.review.reviewedAgainstHash]);
  write(OUTPUT_CSV, '\ufeff' + [headers, ...rows].map((row) => row.map(csv).join(',')).join('\n') + '\n');
}

export function main() {
  const report = acceptAiRecommendations();
  write(OUTPUT_JSON, JSON.stringify(report, null, 2) + '\n');
  writeCsv(report);
  console.log(`[taxonomy-ai-review] reviewed=${report.summary.reviewedCount} decisions=${JSON.stringify(report.summary.decisionCounts)}`);
  console.log(`[taxonomy-ai-review] outputs: ${OUTPUT_JSON}, ${OUTPUT_CSV}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
