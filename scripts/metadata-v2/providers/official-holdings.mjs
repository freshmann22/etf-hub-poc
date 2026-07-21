import { parseKodexHoldingsPayload, parseTigerHoldingsHtml } from '../../../server/providers/issuer/index.js';
import { parseSolHoldingsPayload } from './sol.mjs';

const KODEX_ROOT = 'https://www.samsungfund.com/api/v1/kodex';
const TIGER_URL = 'https://investments.miraeasset.com/tigeretf/ko/reference/pdf-status-list.ajax';
const SOL_ROOT = 'https://www.soletf.com';

function artifact(url, body, contentType = null, role = 'holdings') {
  return { url, body, contentType, role };
}

function parsedResult({ rows, asOfDate = null, rawArtifacts = [], declaredCount = null }) {
  return { rows, asOfDate, rawArtifacts, declaredCount };
}

export class KodexDirectHoldingsAdapter {
  constructor(client) {
    this.sourceId = 'issuer_kodex';
    this.client = client;
  }

  async collect(target) {
    const query = new URLSearchParams({ ordrColm: 'NAV', ordrSort: 'DESC', pageNo: '1', srchTerm: 'w', srchVal: target.shortCode });
    const productUrl = `${KODEX_ROOT}/product.do?${query}`;
    const productResponse = await this.client.request(productUrl);
    const productPayload = JSON.parse(productResponse.body);
    const products = Array.isArray(productPayload?.data) ? productPayload.data : Array.isArray(productPayload) ? productPayload : [];
    const product = products.find((item) => String(item?.stkTicker || '').trim().toUpperCase() === target.shortCode && item?.fId);
    const rawArtifacts = [artifact(productUrl, productResponse.body, productResponse.contentType, 'product_lookup')];
    if (!product) return parsedResult({ rows: [], rawArtifacts });

    const baseDate = String(product.gijunYMD || '').trim();
    const holdingsUrl = `${KODEX_ROOT}/product-pdf/${encodeURIComponent(product.fId)}.do${baseDate ? `?gijunYMD=${encodeURIComponent(baseDate)}` : ''}`;
    const holdingsResponse = await this.client.request(holdingsUrl);
    rawArtifacts.push(artifact(holdingsUrl, holdingsResponse.body, holdingsResponse.contentType));
    const parsed = parseKodexHoldingsPayload(JSON.parse(holdingsResponse.body));
    return parsedResult({ rows: parsed.rows, asOfDate: parsed.baseDate || baseDate || null, rawArtifacts, declaredCount: parsed.declaredCount });
  }
}

export class TigerDirectHoldingsAdapter {
  constructor(client) {
    this.sourceId = 'issuer_tiger';
    this.client = client;
  }

  async collect(target) {
    if (!/^KR[0-9A-Z]{9}\d$/.test(target.isin || '')) throw new Error(`verified ISIN required for TIGER ${target.shortCode}`);
    const body = new URLSearchParams({ pageIndex: '1', firstIndex: '0', listCnt: '2000', ksdFund: target.isin, jongName: '' }).toString();
    const response = await this.client.request(TIGER_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body,
    });
    const parsed = parseTigerHoldingsHtml(response.body);
    return parsedResult({
      rows: parsed.rows,
      rawArtifacts: [artifact(TIGER_URL, response.body, response.contentType)],
      declaredCount: parsed.declaredCount,
    });
  }
}

export class SolDirectHoldingsAdapter {
  constructor(client) {
    this.sourceId = 'issuer_sol';
    this.client = client;
    this.catalog = null;
    this.catalogArtifact = null;
  }

  async loadCatalog() {
    if (this.catalog) return;
    const url = `${SOL_ROOT}/api/common/searchByEtfNameOrFilter`;
    const body = new URLSearchParams({ viewCount: '100' }).toString();
    const response = await this.client.request(url, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body,
    });
    const payload = JSON.parse(response.body);
    this.catalog = new Map((payload?.items || []).filter((item) => item?.ETF_CD6 && item?.FUND_CD).map((item) => [String(item.ETF_CD6), item]));
    this.catalogArtifact = artifact(url, response.body, response.contentType, 'product_catalog');
  }

  async collect(target) {
    await this.loadCatalog();
    const product = this.catalog.get(target.shortCode);
    const rawArtifacts = this.catalogArtifact ? [this.catalogArtifact] : [];
    this.catalogArtifact = null;
    if (!product) return parsedResult({ rows: [], rawArtifacts });
    const workDate = String(product.WORK_DT || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(workDate)) throw new Error(`SOL work date missing for ${target.shortCode}`);
    const url = `${SOL_ROOT}/api/fund/pdfList?fund_cd=${encodeURIComponent(product.FUND_CD)}&work_dt=${workDate}`;
    const response = await this.client.request(url);
    rawArtifacts.push(artifact(url, response.body, response.contentType));
    const parsed = parseSolHoldingsPayload(JSON.parse(response.body), target.shortCode);
    return parsedResult({ rows: parsed.rows, asOfDate: parsed.asOfDate, rawArtifacts, declaredCount: parsed.rows.length });
  }
}

export function createOfficialHoldingsAdapters(client) {
  return new Map([
    ['samsung-asset-management', new KodexDirectHoldingsAdapter(client)],
    ['mirae-asset-global-investments', new TigerDirectHoldingsAdapter(client)],
    ['shinhan-asset-management', new SolDirectHoldingsAdapter(client)],
  ]);
}
