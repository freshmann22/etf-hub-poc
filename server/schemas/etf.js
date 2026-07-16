// 공통 ETF 데이터 스키마 + 메타데이터 envelope.
// 모든 주요 데이터 객체는 출처/기준시각/상태 메타데이터를 포함한다.
// 숫자는 원시값(number|null)만 담는다 — 표시용 포매팅은 프런트 formatter 책임.
import { Status } from '../lib/errors.js';
import { computeDelay } from '../lib/normalize.js';

/**
 * @typedef {Object} DataMeta
 * @property {string} source        - 공급자 식별자 (예: 'mock', 'krx', 'dart')
 * @property {string} updatedAt     - 응답 생성/수집 시각 (Asia/Seoul ISO)
 * @property {string|null} asOfDate  - 데이터 기준 시각 (Asia/Seoul ISO)
 * @property {boolean} isDelayed
 * @property {number|null} delayMinutes
 * @property {'ok'|'stale'|'partial'|'unavailable'} status
 * @property {string|null} errorCode
 * @property {number} quality        - 0~1 신뢰도 플래그
 */

/**
 * 메타데이터 envelope 생성. now 는 테스트 주입용.
 */
export function makeMeta({
  source,
  asOfDate = null,
  updatedAt = null,
  status = Status.OK,
  errorCode = null,
  quality = 1,
  now,
  delayThresholdMinutes = 1,
} = {}) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  const { delayMinutes, isDelayed } = computeDelay(asOfDate, {
    now: nowMs,
    thresholdMinutes: delayThresholdMinutes,
  });
  return {
    source: source || 'unknown',
    updatedAt: updatedAt || new Date(nowMs).toISOString(),
    asOfDate,
    isDelayed,
    delayMinutes,
    status: isDelayed && status === Status.OK ? Status.STALE : status,
    errorCode,
    quality,
  };
}

/** 리스트/객체를 { data, meta } envelope 로 감싼다. */
export function envelope(data, meta) {
  return { data, meta };
}

/** 여러 부분 응답의 상태를 종합해 전체 상태 판정. */
export function combineStatus(metas) {
  const list = Array.isArray(metas) ? metas : [];
  if (list.length === 0) return Status.UNAVAILABLE;
  const statuses = list.map((m) => (m && m.status) || Status.UNAVAILABLE);
  if (statuses.every((s) => s === Status.UNAVAILABLE)) return Status.UNAVAILABLE;
  if (statuses.some((s) => s === Status.UNAVAILABLE || s === Status.PARTIAL)) return Status.PARTIAL;
  if (statuses.some((s) => s === Status.STALE)) return Status.STALE;
  return Status.OK;
}

// --- 스키마 필드 카탈로그 (문서/검증 참조용, 화면 요구 필드 분류) ---
export const ETF_FIELD_CATALOG = Object.freeze({
  identity: ['code', 'standardCode', 'name', 'issuer', 'indexName', 'listingDate', 'etfType', 'region', 'assetClass', 'theme', 'expenseRatio'],
  price: ['price', 'change', 'changeRate', 'volume', 'tradingValue', 'marketCap', 'netAssets', 'nav', 'inav', 'premiumDiscountRate', 'trackingError'],
  performance: ['return1d', 'return1w', 'return1m', 'return3m', 'return6m', 'return1y'],
  holding: ['stockCode', 'stockName', 'weight', 'shares', 'marketValue', 'rank', 'asOfDate'],
  distribution: ['exDate', 'payDate', 'amount', 'currency'],
  disclosure: ['id', 'disclosureType', 'title', 'date', 'url', 'source'],
});

/** 빈 EtfSummary 골격 (필드 존재 보장, 값 null). */
export function emptyEtfSummary(code) {
  return {
    code: code || null,
    standardCode: null,
    name: null,
    issuer: null,
    price: null,
    change: null,
    changeRate: null,
    volume: null,
    tradingValue: null,
    nav: null,
    inav: null,
    premiumDiscountRate: null,
    marketCap: null,
    netAssets: null,
    expenseRatio: null,
  };
}
