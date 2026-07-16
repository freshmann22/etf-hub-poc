// Mock 공급자 — 항상 구현됨. e2e 파이프라인 구동용.
// server/holdings/fixtures/<etfCode>.json 픽스처를 읽어 "원시(raw) 공급자 형태"를 반환한다.
// 정규화(공통 스키마 변환)는 하지 않는다 — normalizer 소관.
//
// 픽스처 규약:
//   - 일반 픽스처: { etfCode, etfName, baseDate, rows:[ {원시행}, ... ] }  → 성공(raw 그대로 반환)
//   - 제어 픽스처: { _control: { status, message } }                        → 실패를 시뮬레이션
//   - 픽스처 파일 없음                                                       → REQUEST_FAILED

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { PROVIDER, SOURCE_TYPE, COLLECTION_STATUS } from '../constants.js';
import { BaseHoldingsProvider, rawSuccess, requestFailed } from './base.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_DIR = resolve(__dirname, '../fixtures');

export class MockHoldingsProvider extends BaseHoldingsProvider {
  // opts.fixtureDir: 테스트에서 픽스처 경로 주입용.
  constructor(opts = {}) {
    super(PROVIDER.MOCK);
    this._fixtureDir = opts.fixtureDir ?? DEFAULT_FIXTURE_DIR;
  }

  isImplemented() {
    return true;
  }

  async fetchRaw(etfCode, _baseDate) {
    const code = String(etfCode ?? '').trim();
    if (code === '') {
      return requestFailed(this.name, 'etfCode 가 비어 있습니다.');
    }

    const path = resolve(this._fixtureDir, `${code}.json`);
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (_err) {
      // 픽스처 없음 = 수집 실패(가짜 성공 금지).
      return requestFailed(this.name, `해당 ETF(${code}) 픽스처가 없습니다.`);
    }

    let fixture;
    try {
      fixture = JSON.parse(text);
    } catch (err) {
      return requestFailed(this.name, `픽스처 파싱 실패(${code}): ${err.message}`);
    }

    // 제어 픽스처: 특정 실패 상태를 시뮬레이션(예: 모든 provider 실패 사례).
    if (fixture && fixture._control) {
      return {
        ok: false,
        provider: this.name,
        status: fixture._control.status ?? COLLECTION_STATUS.REQUEST_FAILED,
        sourceType: null,
        raw: null,
        message: fixture._control.message ?? `Mock 제어 실패(${code}).`,
      };
    }

    // 일반 픽스처: 원시 데이터를 그대로 반환한다.
    return rawSuccess(this.name, fixture, SOURCE_TYPE.MOCK);
  }
}

export default MockHoldingsProvider;
