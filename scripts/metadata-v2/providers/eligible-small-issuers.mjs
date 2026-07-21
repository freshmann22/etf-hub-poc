const KCGI_ORIGIN = 'https://www.kcgiam.com';
const THEJ_ORIGIN = 'https://www.thejasset.com';

export function parseKcgiListHtml(html) {
  const rows = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']*etf-product\.php\?[^"']*idx=(\d+)[^"']*)["'][^>]*class=["'][^"']*fund-item[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = clean(match[3]);
    if (name) rows.push({ productId: match[2], name, productUrl: `${KCGI_ORIGIN}/fund/etf-product.php?goPage=View&idx=${match[2]}` });
  }
  return rows;
}

export function parseKcgiProductHtml(html, { expectedName, expectedTicker, productId, sourceUrl } = {}) {
  const source = String(html || '');
  const title = clean(source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  const ticker = source.match(/(?:^|[^0-9A-Z])([0-9A-Z]{6})(?:[^0-9A-Z]|$)/i)?.[1]?.toUpperCase() || null;
  const pairs = tablePairs(source);
  const objective = clean(source.match(/<div\b[^>]*id=["']sec1["'][^>]*>[\s\S]*?<p\b[^>]*class=["'][^"']*doc-txt[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '') || null;
  const benchmarkName = findPair(pairs, /\ubca4\uce58\ub9c8\ud06c|\uae30\ucd08\uc9c0\uc218/);
  const distributionPolicy = findPair(pairs, /\ubd84\ubc30|\uc9c0\uae09\uae30\uc900/);
  return metadataResult({ productId, title, ticker, expectedName, expectedTicker, description: objective, objective, benchmarkName, benchmarkDescription: objective, distributionPolicy, sourceUrl });
}

export function parseThejProductHtml(html, { expectedName, expectedTicker, sourceUrl } = {}) {
  const source = String(html || '');
  const title = clean(source.match(/<div\b[^>]*class=["'][^"']*tit-area[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
  const subtitle = clean(source.match(/<div\b[^>]*class=["'][^"']*subt-area[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
  const ticker = subtitle.match(/\(([0-9A-Z]{6})\)/i)?.[1]?.toUpperCase() || null;
  const articles = [...source.matchAll(/<article\b[^>]*class=["'][^"']*b-article[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)].map((match) => ({
    label: clean(match[1].match(/class=["'][^"']*b-article__tit[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] || ''),
    value: clean(match[1]),
  }));
  const objectiveArticle = articles.find((row) => /\ud22c\uc790\ubaa9\uc801|\uc6b4\uc6a9\ubaa9\ud45c|\ud22c\uc790\uc804\ub7b5|\ud22c\uc790\ud3ec\uc778\ud2b8/.test(row.label));
  const benchmarkArticle = articles.find((row) => /\uae30\ucd08\uc9c0\uc218|\ube44\uad50\uc9c0\uc218|\ubca4\uce58\ub9c8\ud06c/.test(row.label));
  const distributionArticle = articles.find((row) => /\ubd84\ubc30/.test(row.label));
  const subtitleBenchmark = subtitle.match(/^(.+?\s\uc9c0\uc218)\s*(?:\ucd94\uc885|ETF|\()/)?.[1] || null;
  const objective = objectiveArticle?.value || clean(source.match(/<[^>]+class=["'][^"']*(?:point|strategy)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || '') || subtitle || null;
  return metadataResult({ title, ticker, expectedName, expectedTicker, description: subtitle || objective, objective, benchmarkName: benchmarkArticle?.value || subtitleBenchmark, benchmarkDescription: benchmarkArticle?.value || subtitle, distributionPolicy: distributionArticle?.value || null, sourceUrl });
}

export class KcgiAdapter {
  constructor(client) { this.client = client; this.sourceId = 'kcgi_official_product_html'; }
  async discover() { const url = `${KCGI_ORIGIN}/fund/etf-product.php?goPage=List`; const response = await this.client.request(url, { timeoutMs: 30000, headers: { accept: 'text/html' } }); return { rows: parseKcgiListHtml(response.body), raw: { url, body: response.body } }; }
  async collect(target) { const response = await this.client.request(target.productUrl, { timeoutMs: 30000, headers: { accept: 'text/html', referer: `${KCGI_ORIGIN}/fund/etf-product.php?goPage=List` } }); return { parsed: parseKcgiProductHtml(response.body, { expectedName: target.sourceName, expectedTicker: target.shortCode, productId: target.productId, sourceUrl: target.productUrl }), raw: { url: target.productUrl, body: response.body } }; }
}

export class ThejAdapter {
  constructor(client) { this.client = client; this.sourceId = 'thej_official_product_html'; this.cached = null; }
  async discover() { const url = `${THEJ_ORIGIN}/etf/etf_product.php`; const response = await this.client.request(url, { timeoutMs: 30000, headers: { accept: 'text/html' } }); this.cached = { url, body: response.body }; const parsed = parseThejProductHtml(response.body, { sourceUrl: url }); return { rows: [{ productId: 'etf_product', shortCode: parsed.identity.shortCode, name: parsed.identity.productName, productUrl: url }], raw: this.cached }; }
  async collect(target) { const raw = this.cached || { url: target.productUrl, body: (await this.client.request(target.productUrl, { timeoutMs: 30000, headers: { accept: 'text/html' } })).body }; return { parsed: parseThejProductHtml(raw.body, { expectedName: target.name, expectedTicker: target.shortCode, sourceUrl: raw.url }), raw }; }
}

function metadataResult({ productId = null, title, ticker, expectedName, expectedTicker, description, objective, benchmarkName, benchmarkDescription, distributionPolicy }) {
  return { identity: { productId, productName: title || null, shortCode: ticker, expectedNameMatches: expectedName ? compatibleName(title, expectedName) : null, expectedTickerMatches: expectedTicker ? ticker === expectedTicker : null }, description: description || null, investmentObjective: objective || null, benchmark: { name: benchmarkName || null, description: benchmarkDescription || null }, distributionPolicy: distributionPolicy || null };
}
function tablePairs(source) { return [...source.matchAll(/<(?:tr|dl)\b[^>]*>([\s\S]*?)<\/(?:tr|dl)>/gi)].flatMap((row) => { const cells = [...row[1].matchAll(/<(?:th|td|dt|dd)\b[^>]*>([\s\S]*?)<\/(?:th|td|dt|dd)>/gi)].map((m) => clean(m[1])); return cells.length >= 2 ? [[cells[0], cells.slice(1).join(' ')]] : []; }); }
function findPair(pairs, pattern) { return pairs.find(([label]) => pattern.test(label))?.[1] || null; }
function compatibleName(a, b) { const x = normalize(a); const y = normalize(b); return Boolean(x && y && (x.includes(y) || y.includes(x))); }
function normalize(value) { return String(value || '').normalize('NFKC').replace(/(?:\ucf00\uc774\uc528\uc9c0\uc544\uc774|KCGI|ETF|\uc99d\uad8c\uc0c1\uc7a5\uc9c0\uc218\ud22c\uc790\uc2e0\ud0c1|\uc99d\uad8c\uc0c1\uc7a5\uc9c0\uc218|\uc99d\uad8c|\uc8fc\uc2dd)/gi, '').replace(/[^0-9a-zA-Z\uac00-\ud7a3]/g, '').toLowerCase(); }
function clean(value) { return decode(String(value || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function decode(value) { return String(value || '').replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(code.toLowerCase().startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10))).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0*39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'); }
