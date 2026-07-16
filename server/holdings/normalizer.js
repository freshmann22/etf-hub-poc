// 정규화기(normalizer) — 원시 공급자 형태(raw) → 공통 스키마 문서(document).
// UI/앱은 절대 원시 공급자 필드를 보지 않는다. 여기서만 공통 형태로 변환한다.
// server/lib/normalize.js 의 헬퍼를 재사용한다(중복 구현 금지).
//
// weightPct 규칙: null = 공란, 0 = 실제 0% — 절대 null→0 강제 변환하지 않는다.

import {
  SCHEMA_VERSION,
  ASSET_TYPE,
  isAssetType,
} from './constants.js';
import {
  parseNumber,
  normalizeCode,
  cleanText,
  nullify,
  toSeoulIso,
} from '../lib/normalize.js';

// 원시 필드 별칭(alias) — 공급자마다 다른 키를 공통 필드로 매핑한다.
const ALIASES = Object.freeze({
  code: ['assetCode', '종목코드', '티커', 'isuCd', 'isuSrtCd', 'code', 'shortCode', '단축코드', 'ISIN', 'isin'],
  name: ['assetName', '종목명', '한글종목명', 'isuNm', 'name', 'itemName', '자산명'],
  weight: ['weightPct', '비중', 'weight', '구성비', '구성비중', 'ratio'],
  quantity: ['quantity', '수량', '주식수', '보유수량', '주식수량'],
  contract: ['contractCount', '계약수', '계약수량', 'contracts'],
  marketValue: ['marketValue', '금액', '평가금액', '시가평가금액', '평가액', '평가금액원'],
  market: ['market', '시장', '시장구분', 'exchange', '거래소'],
  currency: ['currency', '통화', '통화코드', 'ccy'],
  rank: ['rank', '순위', '순번', 'no'],
  assetType: ['assetType', '유형', '자산유형', 'type', '종목유형', '구분', '종류'],
});

// 자산유형 토큰(한글/영문) → ASSET_TYPE. 미상은 UNKNOWN.
const ASSET_TYPE_TOKENS = Object.freeze([
  [/(보통주|우선주|주식|주권|equity|stock|share)/i, ASSET_TYPE.EQUITY],
  [/(상장지수|\betf\b)/i, ASSET_TYPE.ETF],
  [/(선물|future)/i, ASSET_TYPE.FUTURE],
  [/(옵션|option)/i, ASSET_TYPE.OPTION],
  [/(스왑|swap)/i, ASSET_TYPE.SWAP],
  [/(국채|회사채|채권|bond)/i, ASSET_TYPE.BOND],
  [/(현금|예금|예치금|cash|원화현금|deposit)/i, ASSET_TYPE.CASH],
  [/(외화|통화|currency|usd|forex|fx)/i, ASSET_TYPE.CURRENCY],
  [/(리츠|reit)/i, ASSET_TYPE.REIT],
  [/(수익증권|펀드|fund)/i, ASSET_TYPE.FUND],
  [/(파생|derivative)/i, ASSET_TYPE.DERIVATIVE],
]);

// 여러 별칭 중 첫 번째로 "값이 있는" 원시 필드를 고른다.
function pick(row, keys) {
  for (const k of keys) {
    if (row != null && Object.prototype.hasOwnProperty.call(row, k)) {
      const v = row[k];
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

// 자산유형 매핑(best-effort). 이미 ASSET_TYPE enum 값이면 그대로 사용.
function mapAssetType(hint) {
  const t = cleanText(hint);
  if (t === null) return ASSET_TYPE.UNKNOWN;
  if (isAssetType(t)) return t; // 이미 표준 값(EQUITY 등)
  for (const [re, type] of ASSET_TYPE_TOKENS) {
    if (re.test(t)) return type;
  }
  return ASSET_TYPE.UNKNOWN;
}

// 구성자산 코드 정규화.
// 국내 6자리(숫자, 선택적 A접두) → 6자리 zero-pad. 해외/ISIN/티커 → 원본 유지.
function normalizeAssetCode(rawCode) {
  const v = nullify(rawCode);
  if (v === null) return null;
  const s = String(v).trim();
  if (/^[A-Za-z]?\d+$/.test(s)) {
    const code = normalizeCode(s);
    if (code !== null) return code;
  }
  return cleanText(s);
}

// YYYYMMDD / YYYY-MM-DD / Date 등을 YYYY-MM-DD 로.
function toDateOnly(value) {
  const iso = toSeoulIso(value);
  if (iso === null) return null;
  return iso.slice(0, 10);
}

// 원시 행 배열을 찾는다: raw.rows / raw.holdings / raw.data / (raw 자체가 배열).
function extractRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.rows)) return raw.rows;
  if (raw && Array.isArray(raw.holdings)) return raw.holdings;
  if (raw && Array.isArray(raw.data)) return raw.data;
  return null;
}

function normalizeRow(row, index) {
  const rawCode = pick(row, ALIASES.code);
  const rawRank = parseNumber(pick(row, ALIASES.rank));
  return {
    assetCode: normalizeAssetCode(rawCode),
    assetName: cleanText(pick(row, ALIASES.name)),
    assetType: mapAssetType(pick(row, ALIASES.assetType)),
    market: cleanText(pick(row, ALIASES.market)),
    currency: cleanText(pick(row, ALIASES.currency)),
    quantity: parseNumber(pick(row, ALIASES.quantity)),
    contractCount: parseNumber(pick(row, ALIASES.contract)),
    marketValue: parseNumber(pick(row, ALIASES.marketValue)),
    // null(공란)과 0(실제 0%)을 구분해서 보존한다.
    weightPct: parseNumber(pick(row, ALIASES.weight)),
    rank: rawRank !== null ? Math.trunc(rawRank) : index + 1,
    // 원본 식별자 보존.
    rawAssetCode: rawCode == null ? null : String(rawCode),
  };
}

/**
 * 원시 데이터를 공통 스키마 문서로 정규화한다.
 * @param {*} raw 공급자 원시 형태(배열 또는 {rows}/{holdings}/{data}).
 * @param {{provider:string, etfCode?:string, baseDate?:string, sourceType?:string|null, generatedAt?:*}} opts
 * @returns {object} 공통 스키마 문서
 * @throws 구조적으로 정규화 불가할 때(호출자가 NORMALIZATION_FAILED 로 처리).
 */
export function normalize(raw, opts = {}) {
  const rows = extractRows(raw);
  if (rows === null) {
    throw new Error('정규화 실패: 원시 데이터에서 행 배열을 찾을 수 없습니다.');
  }

  const provider = opts.provider;
  const etfCode = cleanText(opts.etfCode ?? (raw && raw.etfCode)) ?? '';
  const etfName = cleanText((raw && raw.etfName) ?? opts.etfName) ?? '';
  const baseDate =
    toDateOnly(opts.baseDate) ??
    toDateOnly(raw && raw.baseDate) ??
    toDateOnly(new Date());
  const generatedAt = toSeoulIso(opts.generatedAt ?? new Date());

  const holdings = rows.map((row, i) => normalizeRow(row ?? {}, i));

  return {
    schemaVersion: SCHEMA_VERSION,
    etfCode,
    etfName,
    baseDate,
    generatedAt,
    source: {
      provider,
      sourceType: opts.sourceType ?? null,
      isFallback: false, // 최종값은 orchestrator 가 설정.
    },
    collection: {
      status: 'OK', // 잠정값. 최종값은 businessValidator/orchestrator 가 설정.
      attemptedProviders: provider ? [provider] : [],
      message: null,
    },
    holdings,
  };
}

export default normalize;
