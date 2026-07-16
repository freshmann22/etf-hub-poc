// Provider 레지스트리 — config 로부터 각 provider 인스턴스를 1회 생성해 보관한다.
// 비밀값은 provider 내부에만 머물며, 레지스트리는 describe()(비밀 미포함)만 외부로 노출한다.
import { config as defaultConfig } from '../config.js';
import { MockProvider } from './mock/index.js';
import { KrxProvider } from './krx/index.js';
import { KindProvider } from './kind/index.js';
import { SeibroProvider } from './seibro/index.js';
import { DartProvider } from './dart/index.js';
import { TossProvider } from './toss/index.js';
import { BrokerProvider } from './broker/index.js';
import { IssuerProvider } from './issuer/index.js';
import { PublicDataProvider } from './publicdata/index.js';

const BUILDERS = {
  mock: MockProvider,
  krx: KrxProvider,
  kind: KindProvider,
  seibro: SeibroProvider,
  dart: DartProvider,
  toss: TossProvider,
  broker: BrokerProvider,
  issuer: IssuerProvider,
  publicdata: PublicDataProvider,
};

export const PROVIDER_IDS = Object.freeze(Object.keys(BUILDERS));

/**
 * 레지스트리 생성. cfg 주입 가능(테스트용).
 * 각 provider 에는 해당 provider 설정 + 공통 http 설정(timeout/retries)을 합쳐 넘긴다.
 */
export function createRegistry(cfg = defaultConfig) {
  const http = cfg.http || {};
  const instances = new Map();
  for (const id of PROVIDER_IDS) {
    const Builder = BUILDERS[id];
    const pcfg = {
      ...(cfg.providers && cfg.providers[id]),
      timeoutMs: http.timeoutMs,
      retries: http.retries,
    };
    instances.set(id, new Builder(pcfg));
  }

  return {
    ids: PROVIDER_IDS,
    get(id) {
      return instances.get(id) || null;
    },
    all() {
      return PROVIDER_IDS.map((id) => instances.get(id));
    },
    // 진단용: 각 provider 의 가용성/capability(비밀값 미포함).
    describeAll() {
      return PROVIDER_IDS.map((id) => instances.get(id).describe());
    },
  };
}

export default createRegistry;
