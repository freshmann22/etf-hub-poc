import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipEntries } from './providers/dart-client.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = resolve(ROOT, 'data/raw/metadata-v2/dart-documents/manifest.json');
const EXTRACTION = resolve(ROOT, 'data/reports/metadata-v2/dart-extraction-canary.json');
const RAW_ROOT = resolve(ROOT, 'data/raw/metadata-v2/dart-viewer-canary');
const OUTPUT = resolve(ROOT, 'data/reports/metadata-v2/dart-body-contract-canary.json');
const CODES = new Set(['0193W0', '0204S0', '0197X0', '0216K0']);
const INTERVAL_MS = 1200;

function clean(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function sleep(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }

let nextAllowedAt = 0;
async function fetchOfficial(url) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://dart.fss.or.kr') throw new Error(`non-DART viewer URL rejected: ${url}`);
  const delay = Math.max(0, nextAllowedAt - Date.now());
  if (delay) await sleep(delay);
  nextAllowedAt = Date.now() + INTERVAL_MS;
  const response = await fetch(parsed, { headers: { 'user-agent': 'etf-hub-metadata-pipeline/0.2 (official-DART-canary; local-only)', accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
  const body = await response.text();
  return { status: response.status, ok: response.ok, body, contentType: response.headers.get('content-type'), url: parsed.href };
}

async function fetchOfficialBinary(url) {
  const parsed = new URL(url, 'https://dart.fss.or.kr');
  if (parsed.origin !== 'https://dart.fss.or.kr') throw new Error(`non-DART download URL rejected: ${url}`);
  const delay = Math.max(0, nextAllowedAt - Date.now());
  if (delay) await sleep(delay);
  nextAllowedAt = Date.now() + INTERVAL_MS;
  const response = await fetch(parsed, { headers: { 'user-agent': 'etf-hub-metadata-pipeline/0.2 (official-DART-canary; local-only)', accept: 'application/pdf' }, signal: AbortSignal.timeout(30000) });
  return { status: response.status, ok: response.ok, body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type'), url: parsed.href };
}

function persist(role, receptionNo, response) {
  const hash = sha256(response.body);
  const folder = resolve(RAW_ROOT, receptionNo);
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, `${hash}.${role}.html`);
  if (!existsSync(path)) writeFileSync(path, response.body, { encoding: 'utf8', flag: 'wx' });
  return { path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(response.body), url: response.url, status: response.status };
}

function persistBinary(role, receptionNo, response, extension) {
  const hash = sha256(response.body);
  const folder = resolve(RAW_ROOT, receptionNo);
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, `${hash}.${role}.${extension}`);
  if (!existsSync(path)) writeFileSync(path, response.body, { flag: 'wx' });
  return { path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: response.body.length, url: response.url, status: response.status, contentType: response.contentType };
}

function analyzeArchive(path) {
  const bytes = readFileSync(path);
  const entries = unzipEntries(bytes);
  const xml = [...entries.entries()].filter(([name]) => name.toLowerCase().endsWith('.xml')).map(([, value]) => Buffer.from(value).toString('utf8')).join('\n');
  const section = xml.match(/<SECTION-1\b([^>]*)>([\s\S]*?)<\/SECTION-1>/i);
  const sectionWithoutTitle = section?.[2].replace(/<TITLE\b[^>]*>[\s\S]*?<\/TITLE>/i, '') || '';
  return {
    zipBytes: bytes.length, entryCount: entries.size, entryNames: [...entries.keys()],
    documentName: clean(xml.match(/<DOCUMENT-NAME\b[^>]*>([\s\S]*?)<\/DOCUMENT-NAME>/i)?.[1]),
    sectionApartSource: section?.[1].match(/APARTSOURCE=["']([^"']+)/i)?.[1] || null,
    sectionTitle: clean(section?.[2].match(/<TITLE\b[^>]*>([\s\S]*?)<\/TITLE>/i)?.[1]),
    sectionPayloadTextLength: clean(sectionWithoutTitle).length,
    attachmentLikeXmlReferences: [...new Set([...xml.matchAll(/(?:href|src|afile|filename)=["']([^"']+)/gi)].map((match) => match[1]))],
  };
}

export function parseViewerMain(html) {
  const nodes = [];
  const blocks = html.match(/var node1 = \{\};[\s\S]*?treeData\.push\(node1\);/g) || [];
  for (const block of blocks) {
    const field = (name) => block.match(new RegExp(`node1\\['${name}'\\]\\s*=\\s*["']([^"']+)["']`))?.[1] || null;
    const text = field('text');
    if (!text) continue;
    nodes.push({ text, rcpNo: field('rcpNo'), dcmNo: field('dcmNo'), eleId: field('eleId'), offset: Number(field('offset')), length: Number(field('length')), dtd: field('dtd') });
  }
  const dcmNos = [...new Set([...html.matchAll(/\bdcmNo\b[^0-9]{0,20}(\d{5,})/gi)].map((match) => match[1]))];
  const viewerPaths = [...new Set([...html.matchAll(/["'](\/report\/viewer\.do\?[^"']+)["']/gi)].map((match) => match[1].replaceAll('&amp;', '&')))];
  const attachmentLinks = [...new Set([...html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map((match) => match[1]).filter((url) => /attach|download|\.pdf(?:$|[?;])/i.test(url)))];
  const attachmentSelect = html.match(/<select\b[^>]*id=["']att["'][^>]*>([\s\S]*?)<\/select>/i)?.[1] || '';
  const attachments = [...attachmentSelect.matchAll(/<option\b[^>]*value=["']rcpNo=(\d+)&amp;dcmNo=(\d+)["'][^>]*>([\s\S]*?)<\/option>/gi)]
    .map((match) => ({ rcpNo: match[1], dcmNo: match[2], label: clean(match[3]) }));
  return {
    nodes, bodyNode: nodes.find((node) => /본\s*문/.test(node.text)) || null, dcmNos,
    viewerPaths, attachmentLinks, attachments,
    attachmentLabelCount: (html.match(/첨부(?:파일|서류|문서)?/g) || []).length,
    apartSourceMentioned: /APARTSOURCE/i.test(html),
  };
}

export function analyzeViewerBody(html) {
  const text = clean(html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' '));
  const keywords = ['투자목적', '운용목적', '투자전략', '운용전략', '비교지수', '기초지수', '분배금', '이익분배'];
  const downloadPaths = [...new Set([...html.matchAll(/href=["'](\/report\/download\.do\?[^"']+)["']/gi)].map((match) => match[1].replaceAll('&amp;', '&')))];
  return {
    textLength: text.length,
    keywordHits: Object.fromEntries(keywords.map((key) => [key, text.includes(key)])),
    substantiveSignals: { investmentMandate: /투자대상|투자신탁.*(?:목적|목표)|목표로\s*운용/.test(text), benchmark: /기초지수|비교지수/.test(text), distribution: /분배금|이익분배/.test(text) },
    downloadPaths, snippet: text.slice(0, 500),
  };
}

function semanticNodes(nodes) {
  const selected = nodes.filter((node) => /투자목적|운용목적|투자전략|운용전략|주요투자|기초지수|비교지수|분배|집합투자기구의 개요/.test(node.text));
  return (selected.length ? selected : [...nodes].sort((a, b) => b.length - a.length)).slice(0, 3);
}

async function fetchNodeBody(target, node) {
  const params = new URLSearchParams({
    rcpNo: node.rcpNo || target.receptionNo, dcmNo: node.dcmNo, eleId: node.eleId,
    offset: String(node.offset), length: String(node.length), dtd: node.dtd || 'dart4.xsd',
  });
  const response = await fetchOfficial(`https://dart.fss.or.kr/report/viewer.do?${params}`);
  return { node, access: { ok: response.ok, status: response.status }, contract: analyzeViewerBody(response.body), raw: persist(`body-${node.dcmNo}-${node.eleId}`, target.receptionNo, response) };
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const extraction = JSON.parse(readFileSync(EXTRACTION, 'utf8'));
  const byCode = new Map(extraction.rows.map((row) => [row.etfCode, row]));
  const targets = manifest.documents.filter((row) => CODES.has(row.etfCode));
  if (targets.length !== 4) throw new Error(`expected 4 existing DART canaries, got ${targets.length}`);
  const rows = [];
  for (const target of targets) {
    const prior = byCode.get(target.etfCode);
    const archive = analyzeArchive(resolve(ROOT, target.relativePath));
    const mainResponse = await fetchOfficial(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${target.receptionNo}`);
    const viewer = parseViewerMain(mainResponse.body);
    const body = mainResponse.ok && viewer.bodyNode?.dcmNo ? await fetchNodeBody(target, viewer.bodyNode) : null;
    const attachmentDocuments = [];
    for (const attachment of viewer.attachments) {
      const attachmentResponse = await fetchOfficial(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${attachment.rcpNo}&dcmNo=${attachment.dcmNo}`);
      const attachmentViewer = parseViewerMain(attachmentResponse.body);
      const sections = [];
      for (const node of semanticNodes(attachmentViewer.nodes)) sections.push(await fetchNodeBody(target, node));
      const downloads = [];
      for (const path of [...new Set(sections.flatMap((section) => section.contract.downloadPaths))]) {
        const downloadResponse = await fetchOfficialBinary(path);
        downloads.push({ access: { ok: downloadResponse.ok, status: downloadResponse.status }, validPdfHeader: downloadResponse.body.subarray(0, 5).toString('ascii') === '%PDF-', raw: persistBinary(`attachment-${attachment.dcmNo}`, target.receptionNo, downloadResponse, 'pdf') });
      }
      attachmentDocuments.push({ attachment, access: { ok: attachmentResponse.ok, status: attachmentResponse.status }, contract: attachmentViewer, raw: persist(`attachment-${attachment.dcmNo}`, target.receptionNo, attachmentResponse), sections, downloads });
    }
    rows.push({
      etfCode: target.etfCode, receptionNo: target.receptionNo, reportName: prior?.reportName || null,
      priorCoverOnly: prior?.extraction?.diagnostics?.coverOnly ?? null, archive,
      viewerMain: { access: { ok: mainResponse.ok, status: mainResponse.status }, contract: viewer, raw: persist('main', target.receptionNo, mainResponse) },
      viewerBody: body, attachmentDocuments,
    });
  }
  const substantiveCount = rows.filter((row) => row.attachmentDocuments.some((document) => document.sections.some((section) => section.contract.textLength >= 400 && section.contract.substantiveSignals.investmentMandate))).length;
  const attachmentCount = rows.filter((row) => row.viewerMain.contract.attachments.length > 0).length;
  const pdfCount = rows.filter((row) => row.attachmentDocuments.some((document) => document.downloads.some((download) => download.validPdfHeader))).length;
  const output = {
    schemaVersion: '1.1.0', generatedAt: new Date().toISOString(), canaryCount: rows.length,
    sourcePolicy: { officialSourcesOnly: true, openDartArchiveInspected: true, officialViewerAndDownloadContractUsed: true, nonOfficialScrapingUsed: false, requestIntervalMs: INTERVAL_MS },
    metrics: { archiveCoverOnlyCount: rows.filter((row) => row.archive.sectionPayloadTextLength < 20).length, substantiveAttachmentSummaryCount: substantiveCount, publicAttachmentContractCount: attachmentCount, validOfficialPdfCount: pdfCount },
    decision: substantiveCount === rows.length && pdfCount === rows.length ? 'official_attachment_pdf_parser_candidate' : 'stop_no_stable_official_body_contract',
    rows,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: OUTPUT, metrics: output.metrics, decision: output.decision }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[dart-body-contract] ${error.message}`); process.exitCode = 1; });
}
