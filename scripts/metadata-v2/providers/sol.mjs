import { MetadataProbeProvider, PROBE_STATUS, makeProbeResult } from './contract.mjs';

const SOL_HOST = 'www.soletf.com';
const MAX_BYTES = 2 * 1024 * 1024;

function toNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/[,%\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDate(value) {
  const raw = String(value || '');
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
}

export function parseSolHoldingsPayload(payload, expectedEtfCode = null) {
  if (!Array.isArray(payload)) throw new Error('SOL holdings payload must be an array');
  const rows = payload.map((item, index) => ({
    stockCode: String(item?.STOCK_CODE || '').trim() || null,
    stockName: String(item?.SEC_NM || '').replace(/\s+/g, ' ').trim() || null,
    weight: toNumber(item?.WT_DISP),
    shares: toNumber(item?.QTY),
    marketValue: toNumber(item?.PRICE),
    rank: index + 1,
    asOfDate: toIsoDate(item?.WORK_DT),
  })).filter((row) => row.stockName);
  const etfCodes = new Set(payload.map((item) => String(item?.ETF_CD6 || '').trim()).filter(Boolean));
  if (expectedEtfCode && etfCodes.size > 0 && (!etfCodes.has(expectedEtfCode) || etfCodes.size > 1)) {
    throw new Error(`SOL ETF code mismatch: expected ${expectedEtfCode}, got ${[...etfCodes].join(',')}`);
  }
  return {
    rows,
    etfCode: etfCodes.size === 1 ? [...etfCodes][0] : null,
    asOfDate: rows.find((row) => row.asOfDate)?.asOfDate || null,
  };
}

async function fetchSolJson(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== SOL_HOST || parsed.pathname !== '/api/fund/pdfList') {
    throw new Error('SOL probe URL is outside the approved public endpoint');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': 'etf-hub-metadata-pipeline/0.1 (personal-poc; local-only)' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`SOL upstream ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('SOL response exceeds 2MB probe limit');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

export class SolPublicJsonProbe extends MetadataProbeProvider {
  constructor(source, options = {}) {
    super(source);
    this.fetchOptions = options;
  }

  async probe(canary, context = {}) {
    const startedAt = new Date().toISOString();
    try {
      if (!/^\d+$/.test(canary.providerKey || '')) throw new Error('SOL canary requires a numeric providerKey');
      const workDate = String(context.workDate || new Date().toISOString().slice(0, 10)).replaceAll('-', '');
      if (!/^\d{8}$/.test(workDate)) throw new Error('SOL workDate must be YYYYMMDD');
      const url = `https://${SOL_HOST}/api/fund/pdfList?fund_cd=${encodeURIComponent(canary.providerKey)}&work_dt=${workDate}`;
      const parsed = parseSolHoldingsPayload(await fetchSolJson(url, this.fetchOptions), canary.etfCode);
      return makeProbeResult({
        source: { ...this.source, officialUrl: url },
        canary,
        status: parsed.rows.length ? PROBE_STATUS.OK : PROBE_STATUS.EMPTY,
        fields: { identity: Boolean(parsed.etfCode), holdings: parsed.rows.length > 0 },
        diagnostics: { rowCount: parsed.rows.length, asOfDate: parsed.asOfDate, upstreamStatus: 'ok' },
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      return makeProbeResult({ source: this.source, canary, status: PROBE_STATUS.FAILED, error, startedAt, finishedAt: new Date().toISOString() });
    }
  }
}
