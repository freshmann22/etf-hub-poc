const ORIGIN = 'https://www.wooriam.kr';

export function parseWonListHtml(html) {
  const rows = [];
  const pattern = /<a\b[^>]*href=["'](?:\/investment\/)?etf-view\/([^"'?#<\s]+)["'][^>]*>[\s\S]*?<h2\b[^>]*class=["'][^"']*product-item__title[^"']*["'][^>]*>([\s\S]*?)<\/h2>[\s\S]*?<p\b[^>]*class=["'][^"']*product-item__text[^"']*["'][^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/a>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    const title = clean(match[2]);
    const ticker = title.match(/\(([0-9A-Z]{6})\)\s*$/i)?.[1] || null;
    const name = title.replace(/\s*\([0-9A-Z]{6}\)\s*$/i, '').trim();
    if (ticker && name) rows.push({ productId: match[1], shortCode: ticker, name, listDescription: clean(match[3]), productUrl: `${ORIGIN}/investment/etf-view/${match[1]}` });
  }
  return [...new Map(rows.map((row) => [row.shortCode, row])).values()];
}

export function parseWonProductHtml(html, { expectedName, expectedTicker, productId, sourceUrl } = {}) {
  const source = String(html || '');
  const title = clean(source.match(/<h1\b[^>]*class=["'][^"']*fund-view__title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  const shortCode = title.match(/\(([0-9A-Z]{6})\)\s*$/i)?.[1] || null;
  const productName = title.replace(/\s*\([0-9A-Z]{6}\)\s*$/i, '').trim() || null;
  const description = clean(source.match(/<h2\b[^>]*class=["'][^"']*fund-view__sub-title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '') || null;
  const objective = clean(source.match(/<p\b[^>]*class=["'][^"']*investment__info[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '') || null;
  const benchmarkName = clean(source.match(/<li\b[^>]*class=["'][^"']*notion__item[^"']*["'][^>]*>[\s\S]*?<p\b[^>]*class=["'][^"']*notion__right[^"']*["'][^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/li>/i)?.[1] || '') || null;
  const pairs = [...source.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)].map((match) => [clean(match[1]), clean(match[2])]);
  const distributionPolicy = pairs.find(([label]) => label === '분배금')?.[1] || null;
  const officialDocumentLinks = [...source.matchAll(/window\.open\(["']([^"']*\/file-download\?uid=[^"']+)["'][^)]*\)[\s\S]*?<\/button>/gi)].map((match) => ({ href: new URL(decode(match[1]), sourceUrl || ORIGIN).href, label: clean(match[0]) }));
  return {
    identity: { productId: productId || null, productName, shortCode, expectedNameMatches: expectedName ? normalize(productName) === normalize(expectedName) : null, expectedTickerMatches: expectedTicker ? shortCode === expectedTicker : null },
    description, investmentObjective: objective, benchmark: { name: benchmarkName, description: objective }, distributionPolicy, officialDocumentLinks,
    evidence: { description: description ? [description] : [], investmentObjective: objective ? [objective] : [], benchmarkName: benchmarkName ? [benchmarkName] : [], benchmarkDescription: objective ? [objective] : [], distributionPolicy: distributionPolicy ? [distributionPolicy] : [] },
  };
}

export class WonProductAdapter {
  constructor(client) { this.client = client; this.sourceId = 'won_official_product_html'; }
  async discover() {
    const url = `${ORIGIN}/investment/etf-list`;
    const response = await this.client.request(url, { timeoutMs: 30000, headers: { accept: 'text/html' } });
    return { rows: parseWonListHtml(response.body), raw: { url, body: response.body } };
  }
  async collect(target) {
    const response = await this.client.request(target.productUrl, { timeoutMs: 30000, headers: { accept: 'text/html', referer: `${ORIGIN}/investment/etf-list` } });
    return { parsed: parseWonProductHtml(response.body, { expectedName: target.sourceName, expectedTicker: target.shortCode, productId: target.productId, sourceUrl: target.productUrl }), raw: { url: target.productUrl, body: response.body } };
  }
}

function clean(value) { return decode(String(value || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function decode(value) { return String(value || '').replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(code.toLowerCase().startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10))).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0*39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'); }
function normalize(value) { return String(value || '').normalize('NFKC').replace(/[^0-9a-zA-Z가-힣+]/g, '').toLowerCase(); }
