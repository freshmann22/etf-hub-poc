// worker(서브에이전트) 결과 JSON Schema 검증(§11). 병합 전 필수 게이트.
// 자동 수정 가능한 형식 문제는 로컬에서 고치고, 의미 문제는 reviewer 대상으로 분리한다.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonCache } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TAXONOMY_FILE = resolve(ROOT, 'config/etf-tagging/etf-taxonomy.json');

function loadTaxonomy() {
  const t = readJsonCache(TAXONOMY_FILE);
  return new Map(t.tags.map((tag) => [tag.id, tag]));
}

function clamp01(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/**
 * batchResult: 서브에이전트가 반환한 파싱된 JSON(배열, ETF별 결과).
 * expectedEtfCodes: 해당 배치의 원래 ETF 코드 목록(순서 무관 비교).
 * 반환: { valid, perEtf: [{etfCode, ok, errors[], warnings[], sanitized}], unexpectedCodes, missingCodes }
 */
export function validateBatchResult(batchResult, expectedEtfCodes) {
  const taxonomy = loadTaxonomy();
  const expectedSet = new Set(expectedEtfCodes);
  const seenSet = new Set();
  const perEtf = [];
  const unexpectedCodes = [];

  const items = Array.isArray(batchResult) ? batchResult : [];

  for (const item of items) {
    const errors = [];
    const warnings = [];
    const etfCode = item?.etfCode;

    if (!etfCode) {
      errors.push('etfCode 없음');
      perEtf.push({ etfCode: null, ok: false, errors, warnings, sanitized: null });
      continue;
    }
    if (!expectedSet.has(etfCode)) {
      unexpectedCodes.push(etfCode);
      continue; // 예상치 못한 ETF 코드 — 거부(§11)
    }
    seenSet.add(etfCode);

    const classifications = Array.isArray(item.classifications) ? item.classifications : [];
    const seenTagIds = new Set();
    const sanitizedClassifications = [];
    for (const c of classifications) {
      if (!c || typeof c.tagId !== 'string') {
        errors.push(`잘못된 classification 항목: ${JSON.stringify(c)}`);
        continue;
      }
      if (!taxonomy.has(c.tagId)) {
        errors.push(`taxonomy에 없는 tagId: ${c.tagId}`);
        continue;
      }
      if (seenTagIds.has(c.tagId)) {
        warnings.push(`중복 tagId 제거: ${c.tagId}`);
        continue;
      }
      const score = clamp01(c.score);
      const confidence = clamp01(c.confidence);
      if (score == null || confidence == null) {
        errors.push(`score/confidence 범위 오류(tagId=${c.tagId}): score=${c.score}, confidence=${c.confidence}`);
        continue;
      }
      seenTagIds.add(c.tagId);
      sanitizedClassifications.push({
        tagId: c.tagId,
        score,
        confidence,
        source: c.source || 'claude_subagent',
        evidence: Array.isArray(c.evidence) ? c.evidence : [],
      });
    }

    const candidateTags = Array.isArray(item.candidateTags)
      ? item.candidateTags.filter((ct) => ct && typeof ct.label === 'string' && ['sector', 'strategy', 'dividend'].includes(ct.suggestedCategory))
      : [];

    perEtf.push({
      etfCode,
      ok: errors.length === 0,
      errors,
      warnings,
      sanitized: {
        etfCode,
        classifications: sanitizedClassifications,
        candidateTags: candidateTags.map((ct) => ({
          label: ct.label,
          suggestedCategory: ct.suggestedCategory,
          score: clamp01(ct.score) ?? 0,
          confidence: clamp01(ct.confidence) ?? 0,
          reason: ct.reason || null,
        })),
        warnings: Array.isArray(item.warnings) ? item.warnings : [],
      },
    });
  }

  const missingCodes = expectedEtfCodes.filter((c) => !seenSet.has(c));
  const valid = unexpectedCodes.length === 0 && perEtf.every((p) => p.ok) && missingCodes.length === 0;

  return { valid, perEtf, unexpectedCodes, missingCodes };
}

/** JSON 파싱 실패 시 원문을 보존하고 실패로 표시한다(§11 "JSON 파싱 실패 시 원문 보존"). */
export function parseAndValidate(rawText, expectedEtfCodes) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return { valid: false, parseError: String(err.message), rawText, perEtf: [], unexpectedCodes: [], missingCodes: expectedEtfCodes };
  }
  return { parseError: null, rawText, ...validateBatchResult(parsed, expectedEtfCodes) };
}
