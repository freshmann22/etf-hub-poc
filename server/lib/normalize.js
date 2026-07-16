// 데이터 정규화 유틸 (순수 함수, Node/브라우저 공용, DOM 접근 없음).
// 외부 공급자마다 다른 원시 표현을 공통 형식으로 정규화한다.
// 원시 "숫자"만 다룬다 — 화면 표시용 문자열 포매팅은 여기서 하지 않는다.

const SEOUL_OFFSET = '+09:00';

/**
 * null/"-"/""/공백/undefined 를 모두 null 로 통일.
 * 그 외는 원본을 반환.
 */
export function nullify(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '' || t === '-' || t === 'N/A' || t === 'null') return null;
    return value;
  }
  return value;
}

/**
 * 콤마/퍼센트/통화기호가 섞인 문자열 또는 숫자를 number|null 로.
 * "1,234" -> 1234, "12.5%" -> 12.5, "-" -> null, "" -> null.
 * NaN/Infinity 는 null.
 */
export function parseNumber(value) {
  const v = nullify(value);
  if (v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[,\s%₩]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * 종목/ETF 코드를 6자리 숫자 문자열로 정규화.
 * "5930" -> "005930", "A005930" -> "005930", 잘못된 값 -> null.
 */
export function normalizeCode(value) {
  const v = nullify(value);
  if (v === null) return null;
  const digits = String(v).replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 6) return null;
  return digits.padStart(6, '0');
}

/**
 * ETF 단축코드 정규화. 순수 숫자는 6자리 zero-pad, 영문 포함 KRX 단축코드(예: '0000D0')는
 * 대문자 원형을 유지한다. normalizeCode 는 영문을 제거해 알파뉴메릭 코드를 망가뜨리므로
 * ETF 코드에는 이 함수를 쓴다. 입력이 비면 원본 문자열을 반환.
 */
export function normalizeEtfCode(value) {
  const s = String(value == null ? '' : value).trim();
  if (s === '') return s;
  if (/^\d+$/.test(s)) return s.length <= 6 ? s.padStart(6, '0') : s;
  return s.toUpperCase();
}

/**
 * 다양한 날짜 입력을 Asia/Seoul(+09:00) 기준 ISO 문자열로.
 * - Date, ISO 문자열, "YYYYMMDD", "YYYY-MM-DD", epoch(ms) 지원.
 * 파싱 불가 시 null.
 */
export function toSeoulIso(value) {
  const v = nullify(value);
  if (v === null) return null;

  // YYYYMMDD (KRX/공시 흔한 형식) -> 해당 일 00:00 KST
  if (typeof v === 'string' && /^\d{8}$/.test(v)) {
    const y = v.slice(0, 4);
    const m = v.slice(4, 6);
    const d = v.slice(6, 8);
    return `${y}-${m}-${d}T00:00:00${SEOUL_OFFSET}`;
  }
  // YYYY-MM-DD (날짜만) -> 해당 일 00:00 KST
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return `${v}T00:00:00${SEOUL_OFFSET}`;
  }

  const date = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(date.getTime())) return null;

  // UTC 기준 절대시각에 +9h 를 더해 KST 벽시계로 표기.
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = kst.getUTCFullYear();
  const mm = pad(kst.getUTCMonth() + 1);
  const dd = pad(kst.getUTCDate());
  const hh = pad(kst.getUTCHours());
  const mi = pad(kst.getUTCMinutes());
  const ss = pad(kst.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${SEOUL_OFFSET}`;
}

/**
 * 소수 비율(0.0125)을 퍼센트 숫자(1.25)로. 이미 퍼센트면 asPercent=true.
 * 입력 정규화 후 number|null.
 */
export function toPercent(value, { fromRatio = false } = {}) {
  const n = parseNumber(value);
  if (n === null) return null;
  return fromRatio ? n * 100 : n;
}

/**
 * 등락 부호 판정: 1 / -1 / 0 / null.
 */
export function signOf(value) {
  const n = parseNumber(value);
  if (n === null) return null;
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

/**
 * 두 기준시각(asOf)과 현재시각으로 지연분(delayMinutes)과 지연여부 계산.
 * now 는 테스트 주입용(ms epoch). 반환: { delayMinutes, isDelayed }.
 */
export function computeDelay(asOfIso, { now, thresholdMinutes = 1 } = {}) {
  const asOf = nullify(asOfIso);
  if (asOf === null) return { delayMinutes: null, isDelayed: false };
  const asOfMs = new Date(asOf).getTime();
  if (Number.isNaN(asOfMs)) return { delayMinutes: null, isDelayed: false };
  const nowMs = typeof now === 'number' ? now : Date.now();
  const diffMin = Math.max(0, Math.round((nowMs - asOfMs) / 60000));
  return { delayMinutes: diffMin, isDelayed: diffMin >= thresholdMinutes };
}

/**
 * 문자열 트림 + 다중 공백 단일화. null 안전.
 */
export function cleanText(value) {
  const v = nullify(value);
  if (v === null) return null;
  return String(v).replace(/\s+/g, ' ').trim();
}
