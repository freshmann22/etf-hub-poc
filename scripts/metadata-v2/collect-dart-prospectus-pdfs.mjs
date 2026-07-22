import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeViewerBody, parseViewerMain } from './probe-dart-body-contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = resolve(ROOT, 'data/reports/metadata-v2/dart-disclosure-index.json');
const RAW_ROOT = resolve(ROOT, 'data/raw/metadata-v2/dart-pdf-batch');
const LEDGER = resolve(RAW_ROOT, 'ledger.jsonl');
const REPORT = resolve(ROOT, 'data/reports/metadata-v2/dart-pdf-collection.json');
const INTERVAL_MS = 1200;

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function sleep(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
function rel(path) { return path.slice(ROOT.length + 1).replaceAll('\\', '/'); }

let nextAllowedAt = 0;
async function fetchDart(url, accept = 'text/html') {
  const parsed = new URL(url, 'https://dart.fss.or.kr');
  if (parsed.origin !== 'https://dart.fss.or.kr') throw new Error(`non-DART URL rejected: ${parsed.href}`);
  const delay = Math.max(0, nextAllowedAt - Date.now());
  if (delay) await sleep(delay);
  nextAllowedAt = Date.now() + INTERVAL_MS;
  const response = await fetch(parsed, { headers: { accept, 'user-agent': 'etf-hub-metadata-pipeline/0.2 (official-DART-batch; contact-local)' }, signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const error = new Error(`DART HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return { bytes, contentType: response.headers.get('content-type'), url: parsed.href };
}

async function persist(universeKey, role, response, extension) {
  const hash = sha256(response.bytes);
  const folder = resolve(RAW_ROOT, universeKey);
  await mkdir(folder, { recursive: true });
  const path = resolve(folder, `${hash}.${role}.${extension}`);
  if (!existsSync(path)) await writeFile(path, response.bytes, { flag: 'wx' });
  return { path: rel(path), sha256: hash, bytes: response.bytes.length, url: response.url, contentType: response.contentType };
}

export function chooseCurrentAttachment(attachments, receptionNo) {
  const shortProspectuses = attachments.filter((item) => /간이\s*투자\s*설명서/.test(item.label));
  return shortProspectuses.find((item) => item.rcpNo === receptionNo) || shortProspectuses[0] || null;
}

function latestLedger(text) {
  const latest = new Map();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    try { const row = JSON.parse(line); latest.set(row.universeKey, row); } catch { /* malformed prior line remains isolated */ }
  }
  return latest;
}

async function collectOne(row) {
  const main = await fetchDart(row.match.viewerUrl);
  const mainHtml = main.bytes.toString('utf8');
  const mainContract = parseViewerMain(mainHtml);
  const attachment = chooseCurrentAttachment(mainContract.attachments, row.match.receptionNo);
  if (!attachment) return { status: 'quarantine', reason: 'no_short_prospectus_attachment', raw: { main: await persist(row.universeKey, 'main', main, 'html') } };

  const attachmentResponse = await fetchDart(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${attachment.rcpNo}&dcmNo=${attachment.dcmNo}`);
  const attachmentContract = parseViewerMain(attachmentResponse.bytes.toString('utf8'));
  const bodyNode = attachmentContract.bodyNode;
  if (!bodyNode) return { status: 'quarantine', reason: 'attachment_body_node_missing', attachment };
  const params = new URLSearchParams({ rcpNo: bodyNode.rcpNo, dcmNo: bodyNode.dcmNo, eleId: bodyNode.eleId, offset: String(bodyNode.offset), length: String(bodyNode.length), dtd: bodyNode.dtd || 'dart4.xsd' });
  const body = await fetchDart(`https://dart.fss.or.kr/report/viewer.do?${params}`);
  const bodyContract = analyzeViewerBody(body.bytes.toString('utf8'));
  if (bodyContract.downloadPaths.length !== 1) return { status: 'quarantine', reason: 'ambiguous_or_missing_pdf_download', attachment, downloadCount: bodyContract.downloadPaths.length };
  const pdf = await fetchDart(bodyContract.downloadPaths[0], 'application/pdf');
  if (pdf.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return { status: 'quarantine', reason: 'download_not_pdf', attachment };
  return {
    status: 'ok', attachment,
    raw: {
      main: await persist(row.universeKey, 'main', main, 'html'),
      attachment: await persist(row.universeKey, 'attachment', attachmentResponse, 'html'),
      body: await persist(row.universeKey, 'body', body, 'html'),
      pdf: await persist(row.universeKey, 'prospectus', pdf, 'pdf'),
    },
  };
}

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  const index = JSON.parse(await readFile(INDEX, 'utf8'));
  await mkdir(RAW_ROOT, { recursive: true });
  const prior = existsSync(LEDGER) ? latestLedger(await readFile(LEDGER, 'utf8')) : new Map();
  const targets = index.rows.filter((row) => row.status === 'mapped' && prior.get(row.universeKey)?.status !== 'ok').slice(0, limit);
  let attempted = 0;
  for (const row of targets) {
    let result;
    try {
      result = await collectOne(row);
    } catch (error) {
      result = { status: error.status === 403 || error.status === 429 ? 'blocked' : 'error', reason: error.status ? `http_${error.status}` : error.name || 'Error', message: error.message };
    }
    const ledgerRow = { schemaVersion: '1.0.0', collectedAt: new Date().toISOString(), universeKey: row.universeKey, shortCode: row.shortCode, officialName: row.officialName, receptionNo: row.match.receptionNo, ...result };
    await appendFile(LEDGER, `${JSON.stringify(ledgerRow)}\n`, 'utf8');
    prior.set(row.universeKey, ledgerRow);
    attempted += 1;
    if (result.status === 'blocked') break;
    if (attempted % 25 === 0) console.log(`[dart-pdf] attempted=${attempted}/${targets.length}`);
  }
  const latest = existsSync(LEDGER) ? [...latestLedger(await readFile(LEDGER, 'utf8')).values()] : [];
  const counts = Object.fromEntries(['ok', 'quarantine', 'pending_ocr', 'error', 'blocked'].map((status) => [status, latest.filter((row) => row.status === status).length]));
  const report = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), sourceIndex: rel(INDEX), sourceMappedCount: index.metrics.mappedCount, collectionPolicy: { officialDartOnly: true, hostIntervalMs: INTERVAL_MS, cache: 'content_addressed_sha256', resume: 'append_only_latest_status', taxonomyMutation: false }, metrics: { ledgerCount: latest.length, ...counts, remaining: index.metrics.mappedCount - counts.ok }, rows: latest };
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: REPORT, attemptedThisRun: attempted, metrics: report.metrics }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`[dart-pdf] ${error.message}`); process.exitCode = 1; });
