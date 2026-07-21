const CLASS_PATTERNS = {
  investmentList: /<ul\b[^>]*class=["'][^"']*summary__investment-list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i,
  benchmarkName: /<div\b[^>]*class=["'][^"']*sub-pages__basic-index-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  benchmarkDescription: /<div\b[^>]*class=["'][^"']*sub-pages__basic-index-desc[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  benchmarkProvider: /<div\b[^>]*class=["'][^"']*sub-pages__basic-index-organization[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  distributionPolicy: /<div\b[^>]*class=["'][^"']*sub-pages__devidend-help[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
};

export function parsePlusProductHtml(html, { expectedName, expectedTicker, sourceUrl } = {}) {
  const source = String(html || '');
  const title = clean(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const productName = title.replace(/\s*\|\s*PLUS ETF\s*$/i, '').trim() || null;
  const listHtml = source.match(CLASS_PATTERNS.investmentList)?.[1] || '';
  const investmentPoints = [...listHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => clean(match[1])).filter(Boolean);
  const benchmarkProviderRaw = extract(source, CLASS_PATTERNS.benchmarkProvider);
  const benchmarkProvider = benchmarkProviderRaw?.replace(/^\s*산출기관\s*:\s*/u, '').trim() || null;
  const distributionSection = extract(source, CLASS_PATTERNS.distributionPolicy);
  const reinvestmentPoint = investmentPoints.find((point) => /분배금[^;]*재투자/u.test(point)) || null;
  const distributionPolicy = distributionSection || reinvestmentPoint;
  const distributionPolicySource = distributionSection ? 'distribution-section' : reinvestmentPoint ? 'investment-point-reinvestment' : null;
  const canonicalHref = source.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || null;
  const prospectusLinks = [...source.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: new URL(decodeEntities(match[1]), sourceUrl || canonicalHref || 'https://www.plusetf.co.kr/').href, label: clean(match[2]) }))
    .filter((link) => /투자설명서/u.test(link.label));
  const normalizedSource = normalize(clean(source));
  const identity = {
    productName,
    tickerVisible: expectedTicker ? normalizedSource.includes(normalize(expectedTicker)) : null,
    expectedNameMatches: expectedName ? normalize(productName) === normalize(expectedName) : null,
    canonicalHref,
  };
  const objective = investmentPoints.length ? investmentPoints.join('; ') : null;
  const benchmark = {
    name: extract(source, CLASS_PATTERNS.benchmarkName),
    description: extract(source, CLASS_PATTERNS.benchmarkDescription),
    provider: benchmarkProvider,
  };
  return {
    identity,
    description: objective,
    investmentObjective: objective,
    investmentPoints,
    benchmark,
    distributionPolicy,
    distributionPolicySource,
    prospectusLinks,
    complete: Boolean(
      identity.productName && identity.tickerVisible !== false && identity.expectedNameMatches !== false
      && objective && benchmark.name && distributionPolicy
    ),
    evidence: {
      description: investmentPoints,
      benchmark: [benchmark.name, benchmark.description, benchmark.provider].filter(Boolean),
      distributionPolicy: distributionPolicy ? [distributionPolicy] : [],
    },
  };
}

function extract(html, pattern) {
  const value = clean(String(html || '').match(pattern)?.[1] || '');
  return value || null;
}

function clean(value) {
  return decodeEntities(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(
      code.toLowerCase().startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10)
    ))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function normalize(value) {
  return String(value || '').normalize('NFKC').replace(/[^0-9a-zA-Z가-힣&]/g, '').toLowerCase();
}
