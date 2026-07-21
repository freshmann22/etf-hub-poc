import { createHash } from 'node:crypto';

const ORIGIN = 'https://riseetf.co.kr';
const ALLOWED_PATH = /^\/prod\/finderDetail\/[A-Za-z0-9]+$/;
const FORBIDDEN_PATHS = [/^\/prod\/document\/divided(?:\/|$)/, /^\/etf\/kor\/product(?:\/|$)/];

function clean(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return clean(value).replace(/^KB\s+/i, '').replace(/\s+/g, '').toLowerCase();
}

export function assertAllowedRiseUrl(value) {
  const url = new URL(value, ORIGIN);
  if (url.origin !== ORIGIN) throw new Error(`RISE adapter rejects cross-origin URL: ${url.origin}`);
  if (FORBIDDEN_PATHS.some((pattern) => pattern.test(url.pathname))) throw new Error(`RISE robots-disallowed path rejected: ${url.pathname}`);
  if (!ALLOWED_PATH.test(url.pathname)) throw new Error(`RISE adapter only fetches /prod/finderDetail/:id: ${url.pathname}`);
  return url.href;
}

export function parseRiseCatalog(html) {
  const products = new Map();
  const patterns = [
    /onclick=["']javascript:location\.href=["']\/prod\/finderDetail\/([A-Za-z0-9]+)["']["'][^>]*>([\s\S]*?)<\/th>/gi,
    /<a[^>]+href=["']\/prod\/finderDetail\/([A-Za-z0-9]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const name = clean(match[2]);
      if (name.startsWith('RISE ')) products.set(normalizeName(name), { productId: match[1], name });
    }
  }
  return [...products.values()];
}

function evidence(rawHash, selector, value) {
  return value ? { rawHash, selector, snippet: clean(value).slice(0, 280) } : null;
}

function metaContent(html, name) {
  const pattern = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i');
  return clean(html.match(pattern)?.[1]);
}

export function parseRiseProductHtml(html, sourceUrl) {
  const rawHash = createHash('sha256').update(html).digest('hex');
  const title = clean(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]) || clean(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
  const identityMatch = title.match(/(RISE\s+.+?)\s*\(([A-Z0-9]{6})\)/i)
    || html.match(/<p class=["']prod_title["']>\s*(RISE[\s\S]*?)<span>\(([A-Z0-9]{6})\)<\/span>/i);
  const productName = clean(identityMatch?.[1] || title.replace(/\s*-\s*RISE ETF.*$/i, ''));
  const shortCode = identityMatch?.[2] || clean(html.match(/\(([A-Z0-9]{6})\)/)?.[1]);

  const keyPoints = [...html.matchAll(/<div class=["'][^"']*key_info[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].map((match) => {
    const block = match[1];
    return {
      title: clean(block.match(/class=["'][^"']*point_title[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]),
      description: clean(block.match(/class=["'][^"']*point_desc[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]),
    };
  }).filter((item) => item.title || item.description);

  const description = keyPoints[0]?.title || metaContent(html, 'description');
  const objective = keyPoints.map((item) => [item.title, item.description].filter(Boolean).join(' — ')).join(' / ') || metaContent(html, 'description');
  const benchmarkName = clean(html.match(/<caption>\s*기본정보:[\s\S]*?기초지수[\s\S]*?<tr[^>]*class=["']no_border["'][^>]*>\s*<td[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1]);
  const indexIntroduction = clean(html.match(/<div class=["'][^"']*intro_index[^"']*["'][^>]*>[\s\S]*?<div class=["'][^"']*txt_desc[^"']*["'][^>]*>\s*(?:<!--[\s\S]*?-->)?\s*<p>([\s\S]*?)<\/p>/i)?.[1]);
  const benchmarkPoint = keyPoints.find((item) => /기초\s*지수|추종|index/i.test(`${item.title} ${item.description}`));
  const benchmarkDescription = indexIntroduction || (benchmarkPoint ? [benchmarkPoint.title, benchmarkPoint.description].filter(Boolean).join(' — ') : null);
  const distributionPolicy = clean(html.match(/분배금\s*지급\s*기준일[\s\S]*?<\/tr>\s*<tr[^>]*class=["']no_border["'][^>]*>\s*<td[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1]);
  const officialDocumentLinks = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(투자설명서|간이투자설명서|신탁계약서|월간\s*운용\s*현황)<\/a>/gi)].map((match) => ({
    label: clean(match[2]), url: new URL(match[1], ORIGIN).href,
  }));

  return {
    sourceUrl, rawHash, productName, shortCode,
    metadata: { productDescription: description, investmentObjective: objective, benchmarkName, benchmarkDescription, distributionPolicy, officialDocumentLinks },
    provenance: {
      productDescription: evidence(rawHash, '.key_info:first-of-type .point_title || meta[name="description"]', description),
      investmentObjective: evidence(rawHash, '.key_info .point_title + .point_desc', objective),
      benchmarkName: evidence(rawHash, 'table caption^="기본정보" row:first td:nth-child(2)', benchmarkName),
      benchmarkDescription: evidence(rawHash, '.intro_index .txt_desc > p || .key_info containing "기초 지수" or "추종"', benchmarkDescription),
      distributionPolicy: evidence(rawHash, 'table header="분배금 지급 기준일" adjacent value cell', distributionPolicy),
      officialDocumentLinks: officialDocumentLinks.map((link) => evidence(rawHash, `.btn_file_download a[label="${link.label}"]`, `${link.label}: ${link.url}`)),
    },
  };
}

export class RiseProductAdapter {
  constructor(client) {
    this.client = client;
    this.sourceId = 'issuer_rise_product';
    this.seedUrl = `${ORIGIN}/prod/finderDetail/44K5`;
    this.catalog = null;
  }

  async discover() {
    if (this.catalog) return this.catalog;
    const response = await this.client.request(assertAllowedRiseUrl(this.seedUrl));
    this.catalog = { products: parseRiseCatalog(response.body), raw: { ...response, url: this.seedUrl } };
    return this.catalog;
  }

  async resolveProduct(target) {
    const catalog = await this.discover();
    const hit = catalog.products.find((product) => normalizeName(product.name) === normalizeName(target.name));
    if (!hit) throw new Error(`RISE product id not found for ${target.shortCode} ${target.name}`);
    return hit;
  }

  async collect(target) {
    const hit = await this.resolveProduct(target);
    const url = assertAllowedRiseUrl(`${ORIGIN}/prod/finderDetail/${hit.productId}`);
    const response = await this.client.request(url);
    return { ...parseRiseProductHtml(response.body, url), productId: hit.productId, raw: { ...response, url } };
  }
}
