import { createHash } from 'node:crypto';

const ORIGIN = 'https://investments.miraeasset.com';
const DETAIL_PATH = '/tigeretf/ko/product/search/detail/index.do';
const ROBOTS_BLOCKED = [/^\/tigeretf\/upload\//, /^\/tigeretf\/(?:member|my-page|common|cmm|common_kr|common_en)(?:\/|$)/];

function clean(value) {
  return String(value || '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#37;/gi, '%')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
}

export function assertAllowedTigerUrl(value) {
  const url = new URL(value, ORIGIN);
  if (url.origin !== ORIGIN) throw new Error(`TIGER adapter rejects cross-origin URL: ${url.origin}`);
  if (ROBOTS_BLOCKED.some((pattern) => pattern.test(url.pathname))) throw new Error(`TIGER robots-disallowed path rejected: ${url.pathname}`);
  if (url.pathname !== DETAIL_PATH || !/^KR[0-9A-Z]{9}\d$/.test(url.searchParams.get('ksdFund') || '')) {
    throw new Error(`TIGER adapter only fetches official product detail with verified ISIN: ${url.pathname}`);
  }
  return url.href;
}

function cardContent(html, label, startAt = 0) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tail = html.slice(startAt);
  const header = new RegExp(`<div class=["'][^"']*c-card-header[^"']*["'][^>]*>\\s*${escaped}\\s*</div>`, 'i').exec(tail);
  if (!header) return null;
  const contentOffset = tail.indexOf('<div class="c-card-content', header.index + header[0].length);
  if (contentOffset < 0) return null;
  const openingEnd = tail.indexOf('>', contentOffset);
  if (openingEnd < 0) return null;
  let depth = 1;
  const tokenPattern = /<div\b[^>]*>|<\/div>/gi;
  tokenPattern.lastIndex = openingEnd + 1;
  let token;
  while ((token = tokenPattern.exec(tail))) {
    depth += /^<\/div/i.test(token[0]) ? -1 : 1;
    if (depth === 0) return clean(tail.slice(openingEnd + 1, token.index));
  }
  return null;
}

function proof(rawHash, selector, value) {
  return value ? { rawHash, selector, snippet: clean(value).slice(0, 320) } : null;
}

export function parseTigerProductHtml(html, sourceUrl) {
  const rawHash = createHash('sha256').update(html).digest('hex');
  const heading = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => clean(match[1]))
    .find((value) => /^TIGER\s*.*\([A-Z0-9]{6}\)$/i.test(value)) || '';
  const identity = heading.match(/^TIGER\s*(.*)\s*\(([A-Z0-9]{6})\)$/i);
  const productName = identity ? `TIGER ${clean(identity[1])}` : '';
  const shortCode = identity?.[2] || null;
  const section1 = html.match(/<div id=["']section1["'][^>]*>([\s\S]*?)<div id=["']section2["']/i)?.[1] || '';
  const productDescription = clean(section1.match(/<div class=["']title["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
  const investmentObjective = cardContent(html, '운용목표');
  const productInfoStart = html.indexOf('<h2 class="title">상품 정보</h2>');
  const benchmarkName = clean(html.slice(Math.max(0, productInfoStart)).match(/<div class=["']label["'][^>]*>\s*기초지수\s*<\/div>\s*<div class=["'][^"']*value[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1])
    || clean(html.match(/<div class=["']title["'][^>]*>\s*벤치마크\s*<\/div>\s*<div class=["']desc["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
  const benchmarkSection = html.indexOf('<h3>기초지수</h3>');
  const benchmarkDescription = benchmarkSection >= 0 ? cardContent(html, '기초지수', benchmarkSection) : null;
  const distributionPolicy = cardContent(html, '분배금 지급 기준일');
  const documentLinks = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(투자설명서|간이투자설명서|월간운용보고서(?:\(FactSheet\))?|집합투자규약)<\/a>/gi)].map((match) => ({
    label: clean(match[2]),
    url: new URL(match[1].replace(/;jsessionid=[^?"']+/i, ''), ORIGIN).href,
    fetchPolicy: 'link_only_robots_disallow_upload',
  }));
  const officialDocumentLinks = [...new Map(documentLinks.map((link) => [`${link.label}:${link.url}`, link])).values()];
  return {
    sourceUrl, rawHash, productName, shortCode,
    metadata: { productDescription, investmentObjective, benchmarkName, benchmarkDescription, distributionPolicy, officialDocumentLinks },
    provenance: {
      productDescription: proof(rawHash, '#section1 .title', productDescription),
      investmentObjective: proof(rawHash, '.c-card-header="운용목표" + .c-card-content', investmentObjective),
      benchmarkName: proof(rawHash, '#section3 .label="기초지수" + .value', benchmarkName),
      benchmarkDescription: proof(rawHash, 'h3="기초지수" + .c-card .c-card-content', benchmarkDescription),
      distributionPolicy: proof(rawHash, '.c-card-header="분배금 지급 기준일" + .c-card-content', distributionPolicy),
      officialDocumentLinks: officialDocumentLinks.map((link) => proof(rawHash, `.temp-resources a[label="${link.label}"]`, `${link.label}: ${link.url}`)),
    },
  };
}

export class TigerProductAdapter {
  constructor(client) { this.client = client; this.sourceId = 'issuer_tiger_product'; }
  async collect(target) {
    if (!/^KR[0-9A-Z]{9}\d$/.test(target.isin || '')) throw new Error(`verified ISIN required for TIGER ${target.shortCode}`);
    const url = assertAllowedTigerUrl(`${ORIGIN}${DETAIL_PATH}?ksdFund=${encodeURIComponent(target.isin)}`);
    const response = await this.client.request(url);
    return { ...parseTigerProductHtml(response.body, url), raw: { ...response, url } };
  }
}
