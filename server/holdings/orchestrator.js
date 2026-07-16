// 오케스트레이터(orchestrator) — fallback 조율.
// 공급자를 PROVIDER_PRIORITY 순서로 시도하여, "스키마 유효 + 업무 채택 가능"한 첫 데이터셋을
// 통째로 채택한다(공급자 간 행 병합 금지). 이후 공급자는 호출하지 않는다.
//
// 파이프라인 순서: provider.fetchRaw → normalize → validateHoldingsDocument(schema)
//                → validateBusiness → 판정.
//
// 기록: collection.attemptedProviders(시도 순서), source.isFallback(첫 시도 공급자가 아니면 true),
//       collection.status, diagnostics.providers(공급자별 실패 사유).

import {
  SCHEMA_VERSION,
  COLLECTION_STATUS,
  PROVIDER,
  PROVIDER_PRIORITY,
} from './constants.js';
import { toSeoulIso } from '../lib/normalize.js';
import { normalize } from './normalizer.js';
import { validateBusiness } from './businessValidator.js';
import { validateHoldingsDocument } from './schemaValidator.js';

// PROVIDER_PRIORITY 순서로 공급자를 정렬한다.
// 우선순위 목록에 없는 공급자(MOCK 등)는 뒤에 원래 순서대로 배치.
function orderByPriority(providers) {
  const list = Array.isArray(providers) ? providers.slice() : [];
  return list
    .map((p, i) => {
      const idx = PROVIDER_PRIORITY.indexOf(p.name);
      return { p, i, rank: idx === -1 ? Number.MAX_SAFE_INTEGER : idx };
    })
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map((x) => x.p);
}

// YYYYMMDD/Date 등을 YYYY-MM-DD 로.
function toDateOnly(value) {
  const iso = toSeoulIso(value);
  return iso === null ? null : iso.slice(0, 10);
}

// 데이터 없이도 스키마 유효한 문서 껍데기(UNRESOLVED 등)를 만든다.
function buildShell(etfCode, baseDate, { status, provider, attempted, message }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    etfCode: String(etfCode ?? ''),
    etfName: '(미확인)',
    baseDate: toDateOnly(baseDate) ?? toDateOnly(new Date()),
    generatedAt: toSeoulIso(new Date()),
    source: {
      provider: provider ?? PROVIDER.MOCK,
      sourceType: null,
      isFallback: false,
    },
    collection: {
      status,
      attemptedProviders: attempted.slice(),
      message: message ?? null,
    },
    holdings: [],
  };
}

/**
 * 구성자산을 해석한다.
 * @param {string} etfCode
 * @param {string|null|undefined} baseDate
 * @param {{ providers: Array<{name:string, isImplemented:Function, fetchRaw:Function}> }} deps
 * @returns {Promise<object>} 공통 스키마 문서
 */
export async function resolveHoldings(etfCode, baseDate, deps = {}) {
  const ordered = orderByPriority(deps.providers);
  const attempted = [];
  const diagnostics = [];

  for (let i = 0; i < ordered.length; i++) {
    const provider = ordered[i];
    attempted.push(provider.name);

    // 1) 원시 수집.
    let rawResult;
    try {
      rawResult = await provider.fetchRaw(etfCode, baseDate);
    } catch (err) {
      diagnostics.push({
        provider: provider.name,
        status: COLLECTION_STATUS.REQUEST_FAILED,
        message: 'fetchRaw 예외: ' + err.message,
      });
      continue;
    }

    if (!rawResult || rawResult.ok !== true) {
      diagnostics.push({
        provider: provider.name,
        status: rawResult?.status ?? COLLECTION_STATUS.REQUEST_FAILED,
        message: rawResult?.message ?? '원시 데이터를 얻지 못했습니다.',
      });
      continue;
    }

    // 2) 정규화.
    let doc;
    try {
      doc = normalize(rawResult.raw, {
        provider: provider.name,
        etfCode,
        baseDate,
        sourceType: rawResult.sourceType ?? null,
      });
    } catch (err) {
      diagnostics.push({
        provider: provider.name,
        status: COLLECTION_STATUS.NORMALIZATION_FAILED,
        message: err.message,
      });
      continue;
    }

    // 3) 스키마(형태) 검증.
    const schema = validateHoldingsDocument(doc);
    if (!schema.valid) {
      diagnostics.push({
        provider: provider.name,
        status: COLLECTION_STATUS.INVALID_SCHEMA,
        message: '스키마 검증 실패',
        errors: schema.errors,
      });
      continue;
    }

    // 4) 업무 검증.
    const business = validateBusiness(doc);
    if (business.errors.length > 0) {
      diagnostics.push({
        provider: provider.name,
        status: business.status,
        message: '업무 검증 실패',
        errors: business.errors,
      });
      continue;
    }

    // 5) 채택 — 데이터셋을 통째로 사용.
    doc.source.isFallback = i > 0; // 첫 시도 공급자가 아니면 fallback.
    doc.collection.status = business.status;
    doc.collection.attemptedProviders = attempted.slice();
    doc.collection.message = business.warnings.length ? business.warnings.join(' / ') : null;
    doc.diagnostics = {
      providerFailures: diagnostics,
      warnings: business.warnings,
    };
    return doc;
  }

  // 모든 공급자 실패 → UNRESOLVED.
  const lastProvider = attempted.length ? attempted[attempted.length - 1] : PROVIDER.MOCK;
  const shell = buildShell(etfCode, baseDate, {
    status: COLLECTION_STATUS.UNRESOLVED,
    provider: lastProvider,
    attempted,
    message: '모든 공급자에서 구성자산을 확보하지 못했습니다.',
  });
  shell.diagnostics = { providerFailures: diagnostics, warnings: [] };
  return shell;
}

export default resolveHoldings;
