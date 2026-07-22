// Issuer provider — 운용사 공식 공개 구성종목 자료.
// 현재는 미래에셋 TIGER의 공개 PDF 조회 AJAX를 지원한다. 로그인/API 키 없이
// 상품 페이지의 "PDF 구성종목" 표를 조회하며, 타 운용사 코드는 빈 결과가 된다.
import { BaseProvider } from '../types.js';
import { ProviderError, ErrorCodes, Status } from '../../lib/errors.js';
import { safeFetchText } from '../../lib/http.js';
import { makeMeta, envelope } from '../../schemas/etf.js';
import { cleanText, parseNumber, toSeoulIso } from '../../lib/normalize.js';

const TIGER_PDF_URL =
  'https://investments.miraeasset.com/tigeretf/ko/reference/pdf-status-list.ajax';
const TIGER_HOST = 'investments.miraeasset.com';
const KODEX_HOST = 'www.samsungfund.com';
const KODEX_API_ROOT = 'https://www.samsungfund.com/api/v1/kodex';
// 해외·파생 ETF는 현금/선물/스왑을 포함해 500행을 넘을 수 있다.
// 응답 크기 제한(8MB)과 별도로 비정상 무한 목록만 막는 넉넉한 상한을 둔다.
const MAX_ROWS = 2000;

export class IssuerProvider extends BaseProvider {
  constructor(config = {}) {
    super({ id: 'issuer', config });
    this.capabilities = {
      getEtfList: false,
      getEtfSummary: false,
      getEtfPrice: false,
      getEtfHoldings: true,
      getEtfPerformance: false,
      getEtfDistributions: false,
      getEtfDisclosures: false,
    };
    this._tigerUrl = config.tigerPdfUrl || TIGER_PDF_URL;
    this._kodexApiRoot = (config.kodexApiRoot || KODEX_API_ROOT).replace(/\/$/, '');
  }

  isAvailable() {
    return this.config.enabled === true;
  }

  async getEtfHoldings(code) {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'issuer provider disabled', { provider: 'issuer' });
    }
    const target = String(code || '').trim().toUpperCase();
    if (!/^[0-9A-Z]{6}$/.test(target)) {
      return envelope([], issuerMeta('issuer', Status.UNAVAILABLE));
    }

    const kodex = await this._getKodexHoldings(target);
    if (kodex) return kodex;
    if (!/^\d{6}$/.test(target)) return envelope([], issuerMeta('issuer', Status.UNAVAILABLE));

    const body = new URLSearchParams({
      pageIndex: '1',
      firstIndex: '0',
      listCnt: String(MAX_ROWS),
      ksdFund: buildKoreanIsin(target),
      jongName: '',
    }).toString();
    const html = await safeFetchText(this._tigerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      provider: 'issuer',
      allowlist: [TIGER_HOST],
      timeoutMs: this.config.timeoutMs || 8000,
      retries: this.config.retries ?? 2,
      maxBytes: 5 * 1024 * 1024,
    });
    const { rows, declaredCount } = parseTigerHoldingsHtml(html);
    const status = rows.length === 0
      ? Status.UNAVAILABLE
      : declaredCount != null && rows.length < declaredCount
        ? Status.PARTIAL
        : Status.OK;
    return envelope(rows, issuerMeta('issuer_tiger', status));
  }

  async _getKodexHoldings(code) {
    const query = new URLSearchParams({
      ordrColm: 'NAV', ordrSort: 'DESC', pageNo: '1', srchTerm: 'w', srchVal: code,
    });
    const productText = await safeFetchText(`${this._kodexApiRoot}/product.do?${query}`, this._kodexOpts());
    const products = parseJson(productText, 'kodex product list');
    const product = (Array.isArray(products?.data) ? products.data : Array.isArray(products) ? products : [])
      .find((item) => cleanText(item?.stkTicker)?.toUpperCase() === code && cleanText(item?.fId));
    if (!product) return null;

    const baseDate = cleanText(product.gijunYMD);
    const pdfUrl = `${this._kodexApiRoot}/product-pdf/${encodeURIComponent(product.fId)}.do` +
      (baseDate ? `?gijunYMD=${encodeURIComponent(baseDate)}` : '');
    const pdfText = await safeFetchText(pdfUrl, this._kodexOpts());
    const parsed = parseKodexHoldingsPayload(parseJson(pdfText, 'kodex holdings'));
    const status = parsed.rows.length === 0
      ? Status.UNAVAILABLE
      : parsed.declaredCount != null && parsed.rows.length < parsed.declaredCount
        ? Status.PARTIAL
        : Status.OK;
    return envelope(parsed.rows, issuerMeta('issuer_kodex', status, parsed.baseDate || baseDate));
  }

  _kodexOpts() {
    return {
      provider: 'issuer',
      allowlist: [KODEX_HOST],
      timeoutMs: this.config.timeoutMs || 8000,
      retries: this.config.retries ?? 2,
      maxBytes: 8 * 1024 * 1024,
    };
  }
}

function issuerMeta(source, status, asOfDate = null) {
  return makeMeta({ source, status, asOfDate: asOfDate ? toSeoulIso(asOfDate) : null, quality: 0.95 });
}

function parseJson(text, label) {
  try { return JSON.parse(text); } catch {
    throw new ProviderError(ErrorCodes.PARSE_ERROR, `${label} json`, { provider: 'issuer' });
  }
}

export function parseKodexHoldingsPayload(payload) {
  const pdf = payload?.data?.pdf || payload?.pdf || null;
  const list = Array.isArray(pdf?.list) ? pdf.list.slice(0, MAX_ROWS) : [];
  const baseDate = cleanText(pdf?.gijunYMD);
  const rows = list.map((item, index) => ({
    stockCode: cleanText(item?.itmNo) || null,
    stockName: cleanText(item?.secNm) || null,
    weight: parseNumber(item?.ratio),
    shares: parseNumber(item?.applyQ),
    marketValue: parseNumber(item?.evalA),
    rank: index + 1,
    asOfDate: baseDate ? toSeoulIso(baseDate) : null,
  })).filter((row) => row.stockName);
  return {
    rows,
    declaredCount: parseNumber(pdf?.totalCnt),
    baseDate,
  };
}

// 한국 ETF 표준코드: KR7 + 단축코드 + 00 + ISO 6166(Luhn) check digit.
export function buildKoreanIsin(code) {
  const shortCode = String(code || '').trim();
  if (!/^\d{6}$/.test(shortCode)) {
    throw new ProviderError(ErrorCodes.BAD_REQUEST, 'numeric 6-character ETF code required', { provider: 'issuer' });
  }
  const base = `KR7${shortCode}00`;
  return base + isinCheckDigit(base);
}

function isinCheckDigit(base) {
  const expanded = [...base.toUpperCase()]
    .map((char) => /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char)
    .join('');
  let sum = 0;
  let double = true;
  for (let i = expanded.length - 1; i >= 0; i -= 1) {
    let digit = Number(expanded[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

export function parseTigerHoldingsHtml(html) {
  const text = String(html || '');
  const rows = [];
  let declaredCount = null;
  for (const match of text.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const attrs = match[1];
    const cells = [...match[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => decodeHtml(cell[1].replace(/<[^>]*>/g, ' ')));
    if (cells.length < 6) continue;
    const rank = parseNumber(cells[0]);
    const stockName = cleanText(cells[2]);
    const weight = parseNumber(cells[5]);
    if (rank == null || !stockName || weight == null) continue;
    const countMatch = attrs.match(/data-tot-cnt=["'](\d+)["']/i);
    if (countMatch) declaredCount = Number(countMatch[1]);
    const rawCode = cleanText(cells[1]);
    rows.push({
      stockCode: rawCode || null,
      stockName,
      weight,
      shares: parseNumber(cells[3]),
      marketValue: parseNumber(cells[4]),
      rank,
      asOfDate: null,
    });
  }
  return { rows, declaredCount };
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export default IssuerProvider;
