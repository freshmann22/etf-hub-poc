import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'https://www.samsungactive.co.kr';
const ROBOTS_URL = `${ORIGIN}/robots.txt`;
const HOME_URL = `${ORIGIN}/`;
const listUrl = (pageNo) => `${ORIGIN}/api/v1/product/etf.do?graphTerm=week&sort=DESC&orderType=YIELD_WEEK&pageNo=${pageNo}`;
const USER_AGENT = 'etf-metadata-v2-canary/1.0';
const INTERVAL_MS = 1200;

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const challengeDetected = (body) => /cf-chl|challenge-platform|attention required|captcha/i.test(body);

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

function writeTextAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, value, 'utf8');
  renameSync(temporary, path);
}

async function strictRequest(url, accept) {
  const response = await fetch(url, {
    headers: { accept, 'user-agent': USER_AGENT },
    redirect: 'error',
  });
  const body = await response.text();
  return {
    url,
    status: response.status,
    ok: response.ok,
    body,
    bytes: Buffer.byteLength(body),
    sha256: sha256(body),
    server: response.headers.get('server'),
    cloudflareRay: response.headers.get('cf-ray'),
    challenge: challengeDetected(body),
  };
}

export function evaluateKoactPolicy({ robots, homepage }) {
  const robotsObservable = robots.ok && !robots.challenge;
  const homepageObservable = homepage.ok && !homepage.challenge;
  const robotsBody = robots.body || '';
  const matchingWildcardGroup = /user-agent\s*:\s*\*/i.test(robotsBody);
  const explicitProductDisallow = matchingWildcardGroup && /disallow\s*:\s*\/(?:api|etf)/i.test(robotsBody);
  const automatedRestrictionFound = /(?:자동|로봇|크롤|스크래핑).{0,80}(?:금지|제한|불가)/i.test(homepage.body || '');
  const circuitOpen = [robots, homepage].some((item) => [403, 429].includes(item.status) || item.challenge);
  const allowed = robotsObservable && homepageObservable && !explicitProductDisallow && !automatedRestrictionFound && !circuitOpen;
  return {
    allowed,
    circuitOpen,
    robotsObservable,
    homepageObservable,
    robotsInterpretation: matchingWildcardGroup
      ? (explicitProductDisallow ? 'matching wildcard group disallows product paths' : 'matching wildcard group has no product-path disallow')
      : 'only Yeti is named; no group matches this collector user-agent, so no robots rule applies',
    publicUseTerms: automatedRestrictionFound
      ? 'an automated-use restriction was detected'
      : 'no site-wide automated-use restriction or general website terms link was observed; footer policies concern privacy, credit information, CCTV, and customer rights',
  };
}

export function reconcileKoactInventory(inventoryRows, officialEtfs) {
  const local = inventoryRows.filter((row) => row.brand === 'KoAct');
  const officialByTicker = new Map(officialEtfs.map((item) => [String(item.stkTicker), item]));
  const mappings = local.map((row) => {
    const ticker = row.identifiers.krxShortCodeCandidate;
    const official = officialByTicker.get(ticker);
    return {
      universeOrdinal: row.universeOrdinal,
      ticker,
      localName: row.sourceRecord.name,
      matched: Boolean(official),
      officialFId: official?.fId || null,
      officialName: official?.fNm || null,
      officialType: official?.typeLnm || null,
      officialListingDate: official?.listD || null,
      nameExact: official ? official.fNm === row.sourceRecord.name : false,
    };
  });
  const localTickers = new Set(local.map((row) => row.identifiers.krxShortCodeCandidate));
  const officialOnly = officialEtfs.filter((item) => !localTickers.has(String(item.stkTicker))).map((item) => ({
    ticker: String(item.stkTicker), fId: item.fId, name: item.fNm, listingDate: item.listD,
  }));
  return {
    localCount: local.length,
    officialCount: officialEtfs.length,
    matchedCount: mappings.filter((item) => item.matched).length,
    exactNameCount: mappings.filter((item) => item.nameExact).length,
    coverage: local.length ? mappings.filter((item) => item.matched).length / local.length : 0,
    mappings,
    officialOnly,
  };
}

export function selectKoactCanaries(reconciliation) {
  const mapped = reconciliation.mappings.filter((item) => item.matched).sort((a, b) => a.universeOrdinal - b.universeOrdinal);
  if (!mapped.length) return [];
  const selected = [mapped[0]];
  const add = (candidate) => { if (candidate && !selected.some((item) => item.ticker === candidate.ticker)) selected.push(candidate); };
  add(mapped.find((item) => item.officialType === '국내주식'));
  add(mapped.find((item) => item.officialType === '혼합자산'));
  add([...mapped].sort((a, b) => String(b.officialListingDate).localeCompare(String(a.officialListingDate)))[0]);
  for (const item of mapped) { if (selected.length >= 4) break; add(item); }
  return selected.slice(0, 4);
}

function findIdentity(value, target, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  const ticker = value.stkTicker ?? value.ticker ?? value.shortCode ?? value.etfCode;
  const fId = value.fId ?? value.fid;
  const name = value.fNm ?? value.name ?? value.productName;
  if (String(fId || '') === target.officialFId || String(ticker || '') === target.ticker) return {
    ticker: ticker == null ? null : String(ticker), fId: fId == null ? null : String(fId), name: name == null ? null : String(name),
  };
  for (const child of Object.values(value)) {
    const found = findIdentity(child, target, depth + 1);
    if (found) return found;
  }
  return null;
}

export function validateKoactProduct(payload, target) {
  const product = payload?.info?.product;
  const identity = product ? { ticker: String(product.stkTicker || ''), fId: String(product.fId || ''), name: String(product.fNm || '') } : findIdentity(payload, target);
  const valid = Boolean(identity)
    && identity.ticker === target.ticker
    && identity.fId === target.officialFId
    && identity.name === target.officialName;
  return { valid, identity };
}

export async function collectKoactCanary({ intervalMs = INTERVAL_MS } = {}) {
  const startedAt = new Date().toISOString();
  const report = {
    schemaVersion: '1.0.0',
    generatedAt: startedAt,
    issuer: { id: 'samsung-active-asset-management', brand: 'KoAct', inventoryCount: 23 },
    probeContract: {
      domain: 'www.samsungactive.co.kr', authenticationUsed: false, challengeBypassAttempted: false,
      cookiesReplayed: false, identityRotationUsed: false, intervalMs, circuitBreaker: ['403', '429', 'cloudflare_challenge'],
      policyRequests: 0, staticContractRequests: 0, officialListRequests: 0, productDetailRequests: 0,
      canaryRequests: 0, fullCollectionRequests: 0,
    },
    policy: null,
    officialList: null,
    canary: { selected: [], results: [], stage: 'not_started' },
    decision: { status: 'initializing', canaryAllowed: false, fullCollectionAllowed: false },
  };

  const robots = await strictRequest(ROBOTS_URL, 'text/plain');
  report.probeContract.policyRequests += 1;
  await sleep(intervalMs);
  const homepage = await strictRequest(HOME_URL, 'text/html');
  report.probeContract.policyRequests += 1;
  report.policy = {
    ...evaluateKoactPolicy({ robots, homepage }),
    observations: [robots, homepage].map(({ body, ...item }) => item),
    robotsBody: robots.ok ? robots.body.trim() : null,
    visibleFooterPolicies: ['개인정보처리방침(고객)', '신용정보활용체제', '영상정보처리기기 운영·관리방침', '고객권리 안내문'],
  };
  if (!report.policy.allowed) {
    report.decision = { status: 'blocked_before_official_list', canaryAllowed: false, fullCollectionAllowed: false };
    return report;
  }

  await sleep(intervalMs);
  const listPages = [];
  const officialEtfs = [];
  let declaredTotalCount = 0;
  for (let pageNo = 1; pageNo <= 5; pageNo += 1) {
    if (pageNo > 1) await sleep(intervalMs);
    const response = await strictRequest(listUrl(pageNo), 'application/json');
    report.probeContract.officialListRequests += 1;
    listPages.push({ url: response.url, httpStatus: response.status, responseBytes: response.bytes, rawSha256: response.sha256, challenge: response.challenge });
    if ([403, 429].includes(response.status) || response.challenge) {
      report.officialList = { pages: listPages };
      report.decision = { status: 'circuit_open_before_product_request', canaryAllowed: false, fullCollectionAllowed: false };
      return report;
    }
    let payload;
    try { payload = JSON.parse(response.body); } catch { payload = null; }
    const pageEtfs = Array.isArray(payload?.etfs) ? payload.etfs : [];
    declaredTotalCount = Math.max(declaredTotalCount, Number(payload?.totalCnt || 0));
    officialEtfs.push(...pageEtfs);
    if (!response.ok || pageEtfs.length === 0 || (declaredTotalCount > 0 && officialEtfs.length >= declaredTotalCount)) break;
  }
  const uniqueOfficialEtfs = [...new Map(officialEtfs.map((item) => [String(item.stkTicker), item])).values()];
  const inventory = JSON.parse(readFileSync(resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'), 'utf8'));
  const reconciliation = reconcileKoactInventory(inventory.rows, uniqueOfficialEtfs);
  report.officialList = {
    pages: listPages,
    declaredTotalCount, returnedCount: uniqueOfficialEtfs.length,
    reconciliation,
    contractSource: `${ORIGIN}/assets/js/product.js`,
  };
  if (listPages.some((page) => page.httpStatus < 200 || page.httpStatus >= 300) || reconciliation.localCount !== 23 || reconciliation.matchedCount !== 23) {
    report.decision = { status: 'blocked_incomplete_official_mapping', canaryAllowed: false, fullCollectionAllowed: false };
    return report;
  }

  const selected = selectKoactCanaries(reconciliation);
  report.canary.selected = selected;
  report.canary.stage = 'one';
  const rawDirectory = resolve(ROOT, 'data/raw/metadata-v2/koact-product-canary', startedAt.slice(0, 10));
  for (let index = 0; index < selected.length; index += 1) {
    if (index > 0) await sleep(intervalMs);
    const target = selected[index];
    const url = `${ORIGIN}/api/v1/product/etf/${encodeURIComponent(target.officialFId)}.do`;
    const response = await strictRequest(url, 'application/json');
    report.probeContract.productDetailRequests += 1;
    report.probeContract.canaryRequests += 1;
    if ([403, 429].includes(response.status) || response.challenge) {
      report.canary.results.push({ ticker: target.ticker, fId: target.officialFId, httpStatus: response.status, challenge: response.challenge, status: 'circuit_open' });
      report.canary.stage = 'stopped';
      report.decision = { status: 'circuit_open_during_canary', canaryAllowed: false, fullCollectionAllowed: false };
      return report;
    }
    let payload;
    try { payload = JSON.parse(response.body); } catch { payload = null; }
    const validation = validateKoactProduct(payload, target);
    const rawPath = resolve(rawDirectory, `${target.ticker}.${response.sha256.slice(0, 12)}.json`);
    if (response.ok && validation.valid) writeTextAtomic(rawPath, response.body);
    report.canary.results.push({
      ticker: target.ticker, fId: target.officialFId, name: target.officialName, url, httpStatus: response.status,
      responseBytes: response.bytes, rawSha256: response.sha256, rawPath: response.ok && validation.valid ? rawPath.slice(ROOT.length + 1).replaceAll('\\', '/') : null,
      validation, status: response.ok && validation.valid ? 'ok' : 'failed',
    });
    if (!response.ok || !validation.valid) {
      report.canary.stage = 'stopped';
      report.decision = { status: index === 0 ? 'one_canary_failed' : 'four_canary_failed', canaryAllowed: false, fullCollectionAllowed: false };
      return report;
    }
    if (index === 0) report.canary.stage = 'four';
  }
  report.canary.stage = 'completed';
  report.decision = {
    status: 'four_canary_passed_awaiting_full_run_approval',
    canaryAllowed: true,
    fullCollectionAllowed: false,
    localExpansionTargetCount: 23,
    note: 'The official live catalog contains one additional product outside the frozen 1,141-row local universe; it is reported but not silently added.',
  };
  return report;
}

export async function runKoactCanary(outputPath = resolve(ROOT, 'data/reports/metadata-v2/koact-product-canary.json')) {
  const report = await collectKoactCanary();
  writeJsonAtomic(outputPath, report);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const report = await runKoactCanary();
  console.log(`[metadata-v2:koact] status=${report.decision.status} mapped=${report.officialList?.reconciliation?.matchedCount || 0}/23 canary=${report.probeContract.canaryRequests}`);
}
