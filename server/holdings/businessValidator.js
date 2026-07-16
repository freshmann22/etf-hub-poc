// 비즈니스 검증기(businessValidator) — 스키마(형태) 검증과 분리된 "업무 규칙" 검증.
// schemaValidator 는 형태만 본다. 여기서는 값의 업무적 타당성을 본다.
//
// 반환: { status, warnings, errors }
//   - errors  : 데이터 채택 불가 사유(orchestrator 가 다음 공급자로 fallback).
//   - warnings: 채택은 하되 주의가 필요한 사항.
//   - status  : 데이터 품질 상태(OK/PARTIAL/WEIGHT_MISSING/EMPTY).
//
// 핵심 규칙: "비중 합계 ≠ 100%"는 절대 error 가 아니다(현금·파생·합성·레버리지/인버스는
// 정당하게 100%를 벗어난다) — WARNING 으로만 남긴다.

import { COLLECTION_STATUS } from './constants.js';

const ETF_CODE_RE = /^[0-9A-Za-z]{6}$/;
const BASE_DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// 비중 합계 허용 오차(%). 이 범위를 벗어나면 경고만 남긴다.
const WEIGHT_SUM_TOLERANCE = 1.0;

export function validateBusiness(document) {
  const errors = [];
  const warnings = [];

  if (!document || typeof document !== 'object') {
    return {
      status: COLLECTION_STATUS.EMPTY,
      warnings,
      errors: ['문서가 비어 있습니다.'],
    };
  }

  // ETF 코드 형식.
  if (!ETF_CODE_RE.test(String(document.etfCode ?? ''))) {
    errors.push('ETF 코드 형식이 올바르지 않습니다: ' + String(document.etfCode));
  }

  // 기준일 형식/존재.
  if (!document.baseDate) {
    errors.push('기준일(baseDate)이 없습니다.');
  } else if (!BASE_DATE_RE.test(String(document.baseDate))) {
    errors.push('기준일 형식이 올바르지 않습니다: ' + String(document.baseDate));
  }

  // 출처(source/provider) 존재.
  if (!document.source || !document.source.provider) {
    errors.push('출처(source.provider) 정보가 없습니다.');
  }

  const holdings = Array.isArray(document.holdings) ? document.holdings : [];

  // 구성종목 존재.
  if (holdings.length === 0) {
    errors.push('구성종목이 없습니다.');
    return { status: COLLECTION_STATUS.EMPTY, warnings, errors };
  }

  // 개별 비중 값 검사(NaN/Infinity → error, 음수 → warning: 인버스/레버리지 정당).
  let nonNullWeightCount = 0;
  let nullWeightCount = 0;
  let weightSum = 0;
  for (let i = 0; i < holdings.length; i++) {
    const w = holdings[i] ? holdings[i].weightPct : undefined;
    if (w === null || w === undefined) {
      nullWeightCount += 1;
      continue;
    }
    if (typeof w !== 'number' || Number.isNaN(w) || !Number.isFinite(w)) {
      errors.push(`구성비중 값이 숫자가 아닙니다(NaN/Infinity): index ${i}`);
      continue;
    }
    nonNullWeightCount += 1;
    weightSum += w;
    if (w < 0) {
      warnings.push(`음수 구성비중이 있습니다(인버스/차입 가능): index ${i} = ${w}`);
    }
  }

  // 중복 자산(assetCode 기준) → warning.
  const seen = new Map();
  for (const h of holdings) {
    const code = h && h.assetCode;
    if (code == null) continue;
    seen.set(code, (seen.get(code) ?? 0) + 1);
  }
  for (const [code, count] of seen) {
    if (count > 1) {
      warnings.push(`중복 구성자산이 있습니다: ${code} (${count}회)`);
    }
  }

  // 비중 결측 상태 판정.
  let status;
  if (nonNullWeightCount === 0) {
    // 모든 비중이 공란.
    status = COLLECTION_STATUS.WEIGHT_MISSING;
    warnings.push('모든 구성비중이 공란입니다.');
  } else if (nullWeightCount > 0) {
    // 일부만 공란.
    status = COLLECTION_STATUS.PARTIAL;
    warnings.push(`일부 구성비중이 공란입니다(${nullWeightCount}건).`);
  } else {
    status = COLLECTION_STATUS.OK;
  }

  // 비중 합계 ≠ 100% → WARNING 만(절대 error 아님).
  if (nonNullWeightCount > 0 && Math.abs(weightSum - 100) > WEIGHT_SUM_TOLERANCE) {
    warnings.push(
      `구성비중 합계가 100%가 아닙니다: ${weightSum.toFixed(2)}% ` +
        '(현금·파생·합성·레버리지/인버스 등으로 정상일 수 있음).',
    );
  }

  return { status, warnings, errors };
}

export default validateBusiness;
