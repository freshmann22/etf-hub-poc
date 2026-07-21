const ORIGIN = 'https://www.1qetf.com';

export function parseHana1qListHtml(html) {
  const rows = [];
  const pattern = /<a\b[^>]*href=["'](?:https?:\/\/[^/]+)?\/pages\/ETFproducts\/ETF_info\.view\.php\?etf_no=(\d+)["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*etf-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    rows.push({ productId: match[1], name: clean(match[2]), productUrl: `${ORIGIN}/pages/ETFproducts/ETF_info.view.php?etf_no=${match[1]}` });
  }
  return [...new Map(rows.filter((row) => row.name).map((row) => [row.productId, row])).values()];
}

export function parseHana1qProductHtml(html, { expectedName, expectedTicker, productId, sourceUrl } = {}) {
  const source = String(html || '');
  const productName = clean(source.match(/<h2\b[^>]*class=["'][^"']*no-etf__name[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '') || null;
  const shortCode = clean(source.match(/<span\b[^>]*class=["'][^"']*no-etf__code[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '') || null;
  const intro = source.match(/<div\b[^>]*class=["'][^"']*no-etfInfo__cnt[^"']*etfInfo[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
  const introPoints = [...intro.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => clean(match[1])).filter(Boolean);
  const description = introPoints.join('; ') || clean(intro) || null;
  const benchmarkName = clean(source.match(/<h3\b[^>]*class=["'][^"']*no-etfInfo__index-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '') || null;
  const benchmarkDescription = clean(source.match(/<p\b[^>]*class=["'][^"']*no-etfInfo__desc[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '') || null;
  const distributionLi = [...source.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].find((match) => /분배금지급/u.test(clean(match[1])))?.[1] || '';
  const distributionPolicy = clean(distributionLi.match(/<span\b[^>]*class=["'][^"']*no-etfInfo__item-data[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '') || null;
  const officialDocumentLinks = [...source.matchAll(/<a\b[^>]*href=["']([^"']*etf\.file\.download\.php\?[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: new URL(decode(match[1]), sourceUrl || ORIGIN).href, label: clean(match[2]) }));
  return {
    identity: {
      productId: productId || null, productName, shortCode,
      expectedNameMatches: expectedName ? normalize(productName) === normalize(expectedName) : null,
      expectedTickerMatches: expectedTicker ? shortCode === expectedTicker : null,
    },
    description, investmentObjective: description,
    benchmark: { name: benchmarkName, description: benchmarkDescription },
    distributionPolicy, officialDocumentLinks,
    evidence: { description: introPoints.length ? introPoints : description ? [description] : [], benchmarkName: benchmarkName ? [benchmarkName] : [], benchmarkDescription: benchmarkDescription ? [benchmarkDescription] : [], distributionPolicy: distributionPolicy ? [distributionPolicy] : [] },
  };
}

export class Hana1qProductAdapter {
  constructor(client) { this.client = client; this.sourceId = 'hana_1q_official_product_html'; }
  async discover() {
    const url = `${ORIGIN}/pages/ETFproducts/ETF.list.php`;
    const response = await this.client.request(url, { timeoutMs: 30000, headers: { accept: 'text/html' } });
    return { rows: parseHana1qListHtml(response.body), raw: { url, body: response.body } };
  }
  async collect(target) {
    const response = await this.client.request(target.productUrl, { timeoutMs: 30000, headers: { accept: 'text/html', referer: `${ORIGIN}/pages/ETFproducts/ETF.list.php` } });
    return { parsed: parseHana1qProductHtml(response.body, { expectedName: target.sourceName, expectedTicker: target.shortCode, productId: target.productId, sourceUrl: target.productUrl }), raw: { url: target.productUrl, body: response.body } };
  }
}

function clean(value) { return decode(String(value || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function decode(value) { return String(value || '').replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(code.toLowerCase().startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10))).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'); }
function normalize(value) { return String(value || '').normalize('NFKC').replace(/[^0-9a-zA-Z가-힣&+]/g, '').toLowerCase(); }
