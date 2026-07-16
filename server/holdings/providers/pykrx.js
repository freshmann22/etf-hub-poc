// PyKrx 공급자 — 어댑터 스켈레톤.
//
// [실제 동작 설계]
//   Python 수집기 scripts/collect_etf_holdings.py 를 node:child_process 로 실행하여
//   pykrx(stock.get_etf_portfolio_deposit_file) 원시 출력(JSON)을 stdout 으로 받는다.
//   즉, JS 는 pykrx 를 직접 import 하지 않고 파이썬 프로세스의 표준출력만 파싱한다.
//
//     const { execFileSync } = require('node:child_process');
//     const out = execFileSync('python', [SCRIPT, etfCode, yyyymmdd], { encoding: 'utf8' });
//     const payload = JSON.parse(out); // { ok, status, raw:{ etfCode, baseDate, rows:[...] }, message }
//
// [자동화 파이프라인에서의 기본 동작]
//   오프라인/결정성 보장을 위해 기본값은 "미구현(NOT_IMPLEMENTED)".
//   Python/pykrx 환경 유무에 파이프라인 테스트가 의존하지 않도록, 실제 프로세스 호출은
//   opts.enableSubprocess === true 로 명시적으로 켠 경우에만 수행한다.
//   실패 시에도 절대 가짜 holdings 를 만들지 않는다.

import { PROVIDER, COLLECTION_STATUS, SOURCE_TYPE } from '../constants.js';
import { BaseHoldingsProvider, notImplemented, requestFailed, rawSuccess } from './base.js';

const DEFAULT_SCRIPT = 'scripts/collect_etf_holdings.py';

export class PyKrxProvider extends BaseHoldingsProvider {
  // opts.enableSubprocess: true 로 켤 때만 실제 파이썬 수집기를 호출한다(기본 false).
  constructor(opts = {}) {
    super(PROVIDER.PYKRX);
    this._enableSubprocess = opts.enableSubprocess === true;
    this._pythonBin = opts.pythonBin ?? 'python';
    this._script = opts.script ?? DEFAULT_SCRIPT;
  }

  // 자동화 파이프라인에서는 서브프로세스를 켜지 않는 한 미구현으로 취급.
  isImplemented() {
    return this._enableSubprocess === true;
  }

  async fetchRaw(etfCode, baseDate) {
    if (!this._enableSubprocess) {
      return notImplemented(
        this.name,
        'PyKrx 수집기는 기본적으로 비활성화되어 있습니다(오프라인 결정성 유지). enableSubprocess:true 로 켜세요.',
      );
    }

    // --- 실제 수집 경로(옵트인) ------------------------------------------
    // 파이썬 수집기를 실행해 원시 pykrx JSON 을 받아온다. 환경 문제/실패 시 REQUEST_FAILED.
    let child;
    try {
      child = await import('node:child_process');
    } catch (err) {
      return requestFailed(this.name, 'node:child_process 를 사용할 수 없습니다: ' + err.message);
    }

    const yyyymmdd = String(baseDate ?? '').replace(/\D/g, '');
    const args = [this._script, String(etfCode)];
    if (yyyymmdd) args.push(yyyymmdd);

    try {
      const out = child.execFileSync(this._pythonBin, args, {
        encoding: 'utf8',
        timeout: 30000,
      });
      const payload = JSON.parse(out);
      // 파이썬 측이 실패를 알린 경우 그대로 실패로 전달(가짜 성공 금지).
      if (!payload || payload.ok !== true || !payload.raw) {
        return {
          ok: false,
          provider: this.name,
          status: payload?.status ?? COLLECTION_STATUS.REQUEST_FAILED,
          sourceType: null,
          raw: null,
          message: payload?.message ?? 'pykrx 수집기가 유효한 데이터를 반환하지 않았습니다.',
        };
      }
      return rawSuccess(this.name, payload.raw, SOURCE_TYPE.KRX_API);
    } catch (err) {
      return requestFailed(this.name, 'pykrx 수집기 실행 실패: ' + err.message);
    }
  }
}

export default PyKrxProvider;
