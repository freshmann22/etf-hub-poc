// 리포지토리(repository) — UI/앱을 위한 유일한 데이터 접근면.
// 내부적으로 orchestrator 를 기본 공급자 세트로 구동한다. pykrx 를 직접 import 하지 않는다.
// (pykrx 는 오프라인 결정성을 위해 기본 세트에서 제외 — 필요 시 상위에서 주입)

import { COLLECTION_STATUS } from './constants.js';
import { resolveHoldings } from './orchestrator.js';
import { MockHoldingsProvider } from './providers/mock.js';
import { KrxDirectProvider } from './providers/krxDirect.js';
import { SeibroProvider } from './providers/seibro.js';
import { IssuerProvider } from './providers/issuer.js';

const DEFAULT_TOP_N = 10;

// 기본 공급자 세트(우선순위 상위 스텁 + 실제 구동은 MOCK).
// 주의: pykrx 는 여기서 import/사용하지 않는다.
function defaultProviders() {
  return [
    new KrxDirectProvider(),
    new SeibroProvider(),
    new IssuerProvider(),
    new MockHoldingsProvider(),
  ];
}

// weightPct 내림차순 정렬(null 은 항상 뒤로). 원본 불변(복사 후 정렬).
function sortByWeightDesc(holdings) {
  return holdings.slice().sort((a, b) => {
    const wa = a && typeof a.weightPct === 'number' ? a.weightPct : null;
    const wb = b && typeof b.weightPct === 'number' ? b.weightPct : null;
    if (wa === null && wb === null) return 0;
    if (wa === null) return 1; // a 를 뒤로
    if (wb === null) return -1; // b 를 뒤로
    return wb - wa;
  });
}

async function resolve(etfCode, baseDate, options = {}) {
  const providers = options.providers ?? defaultProviders();
  return resolveHoldings(etfCode, baseDate, { providers });
}

/**
 * 전체 구성자산 문서를 반환한다.
 */
export async function getEtfHoldings(etfCode, baseDate, options = {}) {
  return resolve(etfCode, baseDate, options);
}

/**
 * 요약 정보를 반환한다: etfCode/etfName/baseDate/source/status + TOP-N + 전체 개수.
 */
export async function getEtfHoldingSummary(etfCode, baseDate, options = {}) {
  const topN = Number.isInteger(options.topN) ? options.topN : DEFAULT_TOP_N;
  const doc = await resolve(etfCode, baseDate, options);
  const holdings = Array.isArray(doc.holdings) ? doc.holdings : [];
  const top = sortByWeightDesc(holdings).slice(0, topN);
  return {
    etfCode: doc.etfCode,
    etfName: doc.etfName,
    baseDate: doc.baseDate,
    source: doc.source,
    status: doc.collection.status,
    totalCount: holdings.length,
    top,
  };
}

/**
 * 수집 상태만 반환한다.
 */
export async function getCollectionStatus(etfCode, baseDate, options = {}) {
  const doc = await resolve(etfCode, baseDate, options);
  return {
    etfCode: doc.etfCode,
    status: doc.collection.status,
    provider: doc.source.provider,
    isFallback: doc.source.isFallback,
    attemptedProviders: doc.collection.attemptedProviders ?? [],
    message: doc.collection.message ?? null,
    isResolved: doc.collection.status !== COLLECTION_STATUS.UNRESOLVED,
  };
}

export default {
  getEtfHoldings,
  getEtfHoldingSummary,
  getCollectionStatus,
};
