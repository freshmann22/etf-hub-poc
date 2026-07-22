const SOL_ORIGIN = 'https://www.soletf.com';

export function parseSolFundListHtml(html) {
  const rows = [];
  const pattern = /<tr\b[^>]*id=["']tr_(\d+)["'][^>]*>[\s\S]*?<a\b[^>]*href=["']\/ko\/fund\/etf\/(\d+)["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*fd-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    if (match[1] !== match[2]) continue;
    const text = clean(match[3]);
    const tickerMatch = text.match(/\(([0-9A-Z]{6})\)\s*$/u);
    if (!tickerMatch) continue;
    rows.push({
      productId: match[1],
      shortCode: tickerMatch[1],
      name: text.slice(0, tickerMatch.index).trim(),
      productUrl: `${SOL_ORIGIN}/ko/fund/etf/${match[1]}`,
    });
  }
  return rows;
}

export function parseSolProductHtml(html, { expectedName, expectedTicker, productId, sourceUrl } = {}) {
  const source = String(html || '');
  const heading = clean(source.match(/<h1\b[^>]*class=["'][^"']*fv-name[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  const identityMatch = heading.match(/^(.*?)\s*\(([0-9A-Z]{6})\)\s*$/u);
  const productName = identityMatch?.[1]?.trim() || null;
  const shortCode = identityMatch?.[2] || null;
  const descriptions = [...source.matchAll(/<p\b[^>]*class=["'][^"']*fv-des[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => clean(match[1])).filter(Boolean);
  const indexHeading = source.search(/<h3\b[^>]*>\s*기초지수정보\s*<\/h3>/u);
  const indexSection = indexHeading >= 0 ? source.slice(indexHeading, indexHeading + 10000) : '';
  const indexDl = indexSection.match(/<dl\b[^>]*class=["'][^"']*g-conts[^"']*["'][^>]*>([\s\S]*?)<\/dl>/i)?.[1] || '';
  const benchmarkName = clean(indexDl.match(/<dt\b[^>]*>([\s\S]*?)<\/dt>/i)?.[1] || '') || null;
  const benchmarkDescriptions = [...indexDl.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)].map((match) => clean(match[1])).filter(Boolean);
  const benchmarkDescription = benchmarkDescriptions.find((value) => !/지수정보\s*더보기/u.test(value)) || null;
  const distributionDl = source.match(/<dl\b[^>]*class=["'][^"']*def[^"']*["'][^>]*>\s*<dt\b[^>]*>\s*분배금지급[\s\S]*?<\/dt>([\s\S]*?)<\/dl>/u)?.[1] || '';
  const distributionParts = [...distributionDl.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)].map((match) => clean(match[1])).filter(Boolean);
  const distributionPolicy = distributionParts.length ? distributionParts.join('; ') : null;
  const documentLinks = [...source.matchAll(/<a\b[^>]*href=["']([^"']*\/api\/etf\/pds\/down\/policyDescription\/\d+\?type=[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: new URL(decodeEntities(match[1]), sourceUrl || SOL_ORIGIN).href, label: clean(match[2]) }));
  const description = descriptions.length ? descriptions.join('; ') : null;
  const identity = {
    productName, shortCode, productId: productId || sourceUrl?.match(/\/etf\/(\d+)/)?.[1] || null,
    expectedNameMatches: expectedName ? normalize(productName) === normalize(expectedName) : null,
    expectedTickerMatches: expectedTicker ? shortCode === expectedTicker : null,
  };
  return {
    identity,
    description,
    investmentObjective: description,
    benchmark: { name: benchmarkName, description: benchmarkDescription },
    distributionPolicy,
    officialDocumentLinks: documentLinks,
    evidence: {
      description: descriptions,
      benchmarkName: benchmarkName ? [benchmarkName] : [],
      benchmarkDescription: benchmarkDescription ? [benchmarkDescription] : [],
      distributionPolicy: distributionParts,
    },
  };
}

export class SolProductAdapter {
  constructor(client) {
    this.client = client;
    this.sourceId = 'sol_official_product_html';
  }

  async discover() {
    const url = `${SOL_ORIGIN}/ko/fund?viewType=E`;
    const response = await this.client.request(url, { timeoutMs: 30000, headers: { accept: 'text/html' } });
    return { rows: parseSolFundListHtml(response.body), raw: { url, body: response.body } };
  }

  async collect(target) {
    const response = await this.client.request(target.productUrl, { timeoutMs: 30000, headers: { accept: 'text/html', referer: `${SOL_ORIGIN}/ko/fund?viewType=E` } });
    return {
      parsed: parseSolProductHtml(response.body, { expectedName: target.sourceName, expectedTicker: target.shortCode, productId: target.productId, sourceUrl: target.productUrl }),
      raw: { url: target.productUrl, body: response.body },
    };
  }
}

function clean(value) {
  return decodeEntities(String(value || '').replace(/<!--([\s\S]*?)-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return String(value || '').replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(code.toLowerCase().startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function normalize(value) {
  return String(value || '').normalize('NFKC').replace(/[^0-9a-zA-Z가-힣&]/g, '').toLowerCase();
}
