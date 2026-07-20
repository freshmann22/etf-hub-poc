// 서버 설정 로더. .env 를 읽되 비밀 원문을 로그/응답에 절대 노출하지 않는다.
// 인증정보가 없는 provider 는 서버를 실패시키지 않고 unavailable 로 처리한다.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootUrl = new URL('../', import.meta.url);
const envPath = fileURLToPath(new URL('.env', rootUrl));

// .env 로드 (있을 때만). Node 20.6+ process.loadEnvFile.
try {
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
} catch {
  // .env 파싱 실패는 치명적이지 않음 — 기본값(mock)으로 진행.
}

const env = process.env;
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const has = (v) => typeof v === 'string' && v.trim() !== '';
const TAG_BRIEF_MODES = Object.freeze(['manual', 'hybrid', 'live']);

export const MODES = Object.freeze(['mock', 'live', 'hybrid']);

export const config = {
  mode: MODES.includes(env.ETF_DATA_MODE) ? env.ETF_DATA_MODE : 'mock',
  defaultProvider: has(env.ETF_DEFAULT_PROVIDER) ? env.ETF_DEFAULT_PROVIDER : 'mock',
  port: num(env.PORT, 4173),

  // 화면 초기 번들에 실 시세(종가/등락률)를 덧입힐지. 기본 off — 구조는 fixture 유지.
  bundleOverlay: env.ETF_BUNDLE_OVERLAY === 'true',

  cache: {
    priceTtlSec: num(env.CACHE_TTL_PRICE_SECONDS, 60),
    metadataTtlSec: num(env.CACHE_TTL_METADATA_SECONDS, 86400),
    holdingsTtlSec: num(env.CACHE_TTL_HOLDINGS_SECONDS, 21600),
    swrSec: num(env.CACHE_SWR_SECONDS, 120),
  },

  http: {
    timeoutMs: num(env.HTTP_TIMEOUT_MS, 8000),
    retries: num(env.HTTP_RETRIES, 2),
  },

  llm: {
    openrouter: {
      apiKey: env.OPENROUTER_API_KEY || '',
      model: env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash',
      baseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      siteUrl: env.OPENROUTER_SITE_URL || 'http://localhost:4174',
      appName: env.OPENROUTER_APP_NAME || 'ETF Hub Reverse Search',
      timeoutMs: num(env.OPENROUTER_TIMEOUT_MS, 30000),
      retries: num(env.OPENROUTER_RETRIES, 0),
    },
    tagBrief: {
      mode: TAG_BRIEF_MODES.includes(env.TAG_BRIEF_MODE) ? env.TAG_BRIEF_MODE : 'manual',
      model: env.TAG_BRIEF_MODEL || env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash',
    },
  },

  // provider 별 인증정보 존재 여부(값 자체는 노출 안 함).
  providers: {
    mock: { enabled: true },
    krx: { enabled: env.KRX_ENABLED !== 'false' }, // 공개 데이터, 키 불필요(베스트에포트)
    kind: { enabled: env.KIND_ENABLED === 'true' }, // 스크래핑 — 기본 비활성
    seibro: { enabled: env.SEIBRO_ENABLED === 'true' }, // 스크래핑 — 기본 비활성
    dart: { apiKey: env.DART_API_KEY || '' },
    // 토스증권 Open API(실 시세 채널). OAuth2 client_credentials.
    toss: {
      clientId: env.TOSS_CLIENT_ID || '',
      clientSecret: env.TOSS_CLIENT_SECRET || '',
      tokenUrl: env.TOSS_TOKEN_URL || '',
      baseUrl: env.TOSS_API_BASE_URL || '',
    },
    broker: {
      baseUrl: env.BROKER_API_BASE_URL || '',
      apiKey: env.BROKER_API_KEY || '',
      apiSecret: env.BROKER_API_SECRET || '',
      accountProfile: env.BROKER_ACCOUNT_PROFILE || '',
    },
    issuer: {
      enabled: env.ISSUER_ENABLED === 'true',
      tigerPdfUrl: env.ISSUER_TIGER_PDF_URL || '',
      kodexApiRoot: env.ISSUER_KODEX_API_ROOT || '',
    },
    // 공공데이터포털(data.go.kr) — ETF 전종목 목록/스냅샷(T+1).
    publicdata: {
      serviceKey: env.PUBLICDATA_SERVICE_KEY || '',
      etfPriceUrl: env.PUBLICDATA_ETF_PRICE_URL || '',
      enabled: env.PUBLICDATA_ENABLED === 'true',
    },
  },
};

// 각 provider 가 실제 호출 가능한 자격을 갖췄는지(비밀값 미노출).
export function providerCredentialStatus() {
  const p = config.providers;
  return {
    mock: true,
    krx: !!p.krx.enabled,
    kind: !!p.kind.enabled,
    seibro: !!p.seibro.enabled,
    dart: has(p.dart.apiKey),
    toss: has(p.toss.clientId) && has(p.toss.clientSecret),
    broker: has(p.broker.baseUrl) && has(p.broker.apiKey) && has(p.broker.apiSecret),
    issuer: !!p.issuer.enabled,
    publicdata: !!p.publicdata.enabled && has(p.publicdata.serviceKey),
  };
}

// 진단용 요약 — 비밀값 원문 없이 "설정됨/미설정"만.
export function describeConfig() {
  const cred = providerCredentialStatus();
  return {
    mode: config.mode,
    defaultProvider: config.defaultProvider,
    cache: config.cache,
    reverseSearch: {
      planner: has(config.llm.openrouter.apiKey) ? 'openrouter' : 'rules',
      model: config.llm.openrouter.model,
      configured: has(config.llm.openrouter.apiKey),
    },
    tagBrief: {
      mode: config.llm.tagBrief.mode,
      model: config.llm.tagBrief.model,
      configured: has(config.llm.openrouter.apiKey),
    },
    providers: Object.fromEntries(
      Object.entries(cred).map(([id, ok]) => [id, ok ? 'configured' : 'unconfigured'])
    ),
  };
}

export default config;
