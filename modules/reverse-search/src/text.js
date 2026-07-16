// 텍스트 정규화 — 공백 제거 + 소문자화. 한글은 대소문자 구분이 없어 영문 티커/키워드용.
export function normalizeText(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '');
}
