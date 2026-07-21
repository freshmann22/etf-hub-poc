import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseDistributionHistoryHtml } from '../scripts/metadata-v2/providers/distribution-history-html.mjs';
import { parseKoactDistributionHistoryJson } from '../scripts/metadata-v2/providers/koact-distribution-history.mjs';
import { convertDistributionHistoryResults, latestSuccessfulDistributionRows } from '../scripts/metadata-v2/convert-distribution-history-results.mjs';

function riseTable(rows) {
  return `<section><h3>분배금 지급현황</h3><table><caption>분배금 지급현황: 분배금 기준일, 분배금 실지급일, 주당분배금(원), 주당과세표준액(원) 표</caption><thead><tr><th>지급기준일</th><th>실지급일</th><th>분배금액(원)</th><th>주당과세표준액(원)</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}
function plusTable(rows) {
  return `<table class="c-table c-table--distribution-payment-status"><caption>분배금 지급현황 테이블</caption><thead><tr><th>지급 기준일</th><th>실 지급일</th><th>분배금 (원)</th><th>주당과세표준액 (원)</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function wonTable(rows) {
  return `<table class="base-table etf-pop"><tr><th>지급 기준일</th><th>실지급일</th><th>주당분배금액(원)</th><th>주당과세표준액(원)</th><th>분배율(%)</th></tr>${rows}</table>`;
}
function row(recordDate, payDate, amount) { return `<tr><td>${recordDate}</td><td>${payDate}</td><td>${amount}</td><td>${amount}</td></tr>`; }
function hash(body) { return createHash('sha256').update(body).digest('hex'); }
function stored(root, path, body) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body, 'utf8');
  return { path: path.replaceAll('\\', '/'), hash: hash(body), url: 'https://issuer.example/product/1' };
}
function entry(raw, overrides = {}) {
  return {
    retrievedAt: '2026-07-21T00:00:00.000Z', sourceId: 'issuer_rise_product', shortCode: '114100',
    isin: 'KR7114100001', status: 'ok', raw, ...overrides,
  };
}

test('RISE history parser emits only explicit actual rows with per-share and currency basis', () => {
  const html = riseTable([
    row('2026-06-09', '2026-06-11', '1,100'),
    row('2026-07-30', '2026-07-31', '500'),
    row('2026-03-09', '2026-03-11', '-1'),
  ].join(''));
  const parsed = parseDistributionHistoryHtml(html, { retrievedAt: '2026-07-21T00:00:00.000Z' });
  assert.equal(parsed.status, 'ok');
  assert.deepEqual(parsed.events, [{ exDate: null, recordDate: '2026-06-09', payDate: '2026-06-11', amount: 1100, currency: 'KRW', perUnit: 1 }]);
  assert.equal(parsed.evidence.perUnitBasis, 'explicit_table_caption_or_header');
  assert.deepEqual(parsed.rejectedRows.map((item) => item.reason), ['future_payment_not_actual', 'amount_missing_or_invalid']);
});

test('PLUS direct table preserves unknown per-share basis instead of inferring it', () => {
  const parsed = parseDistributionHistoryHtml(plusTable(row('2026.04.30', '2026.05.06', '500')), { retrievedAt: '2026-07-21T00:00:00.000Z' });
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].amount, 500);
  assert.equal(parsed.events[0].currency, 'KRW');
  assert.equal(parsed.events[0].perUnit, null);
  assert.equal(parsed.evidence.perUnitBasis, 'not_explicit_in_raw_table');
});

test('WON direct table emits only explicit per-share KRW actual payments', () => {
  const parsed = parseDistributionHistoryHtml(wonTable(row('2025.10.29', '2025.11.04', '57')), { retrievedAt: '2026-07-21T00:00:00.000Z' });
  assert.deepEqual(parsed.events, [{ exDate: null, recordDate: '2025-10-29', payDate: '2025-11-04', amount: 57, currency: 'KRW', perUnit: 1 }]);
  assert.equal(parsed.evidence.selector, 'table.base-table.etf-pop');
  assert.equal(parsed.evidence.perUnitBasis, 'explicit_table_caption_or_header');
});

test('schedule prose and popup links are not promoted to actual payment history', () => {
  const schedule = parseDistributionHistoryHtml('<dl><dt>분배금지급</dt><dd>매월 마지막 영업일 지급 가능</dd></dl>');
  assert.equal(schedule.events.length, 0);
  assert.equal(schedule.diagnostic, 'policy_only_or_no_history_table');
  const popup = parseDistributionHistoryHtml('<a href="javascript:etfPdsPopup.doc0101P(1)">분배금 현황</a>');
  assert.equal(popup.events.length, 0);
  assert.equal(popup.diagnostic, 'external_popup_not_in_raw_html');
});

test('converter selects latest successful raw, emits field evidence, and reports unavailable sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-distribution-history-'));
  const riseRaw = stored(root, 'raw/rise.html', riseTable(row('2026-06-09', '2026-06-11', '942')));
  const plusRaw = stored(root, 'raw/plus.html', plusTable(row('2026.04.30', '2026.05.06', '500')));
  const solRaw = stored(root, 'raw/sol.html', '<a href="javascript:etfPdsPopup.doc0101P(1)">분배금 현황</a>');
  const hanaRaw = stored(root, 'raw/hana.html', '<li>분배금지급 <span>매월 지급 가능</span></li>');
  const riseOld = entry(riseRaw, { retrievedAt: '2026-07-20T00:00:00.000Z' });
  const riseLatest = entry(riseRaw, { retrievedAt: '2026-07-21T00:00:00.000Z' });
  const riseLaterFailure = entry(riseRaw, { retrievedAt: '2026-07-22T00:00:00.000Z', status: 'validation_failed' });
  assert.equal(latestSuccessfulDistributionRows([riseOld, riseLatest, riseLaterFailure])[0].retrievedAt, riseLatest.retrievedAt);
  const output = convertDistributionHistoryResults({
    rootDir: root,
    ledgerTexts: {
      rise: [riseOld, riseLatest, riseLaterFailure].map(JSON.stringify).join('\n'),
      plus: JSON.stringify(entry(plusRaw, { sourceId: 'plus_official_product_html', shortCode: '152100' })),
      sol: JSON.stringify(entry(solRaw, { sourceId: 'sol_official_product_html', shortCode: '0005D0' })),
      hana1q: JSON.stringify(entry(hanaRaw, { sourceId: 'hana_1q_official_product_html', shortCode: '0004G0' })),
    },
  });
  assert.equal(output.sourceResult.records.length, 2);
  assert.equal(output.sourceResult.records[0].fields['distribution.history'][0].currency, 'KRW');
  assert.match(output.sourceResult.records[0].evidence['distribution.history'].extractionRule, /schedule_text_excluded/);
  assert.equal(output.sourceResult.records[0].provenance.contentHash.length, 64);
  assert.equal(output.report.totals.latestSuccessfulRawCount, 4);
  assert.equal(output.report.totals.emittedRecordCount, 2);
  assert.equal(output.report.sources.sol.unavailableReasons.history_is_external_popup_not_present_in_saved_html, 1);
  assert.equal(output.report.sources.hana1q.unavailableReasons.no_history_table_in_saved_html, 1);
});

test('converter quarantines a raw hash mismatch and emits no field', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-distribution-history-'));
  const raw = stored(root, 'raw/rise.html', riseTable(row('2026-06-09', '2026-06-11', '942')));
  const output = convertDistributionHistoryResults({
    rootDir: root,
    ledgerTexts: { rise: JSON.stringify(entry({ ...raw, hash: '0'.repeat(64) })) },
  });
  assert.equal(output.sourceResult.records.length, 0);
  assert.equal(output.sourceResult.quarantine.items[0].reason, 'raw_hash_mismatch');
});

test('converter emits verified SOL API history as partial with unknown per-share basis', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-distribution-history-'));
  const raw = stored(root, 'raw/sol-api.json', JSON.stringify({ fundName: 'SOL 테스트', totalCount: 1, items: [{ FUND_CD: '211079', WORK_DT: '20251230', DIVIDEND_DT: '20260102', DIVIDEND_PRI: 13 }] }));
  const contract = stored(root, 'raw/etf_pds.js', '분배금액(원) item.DIVIDEND_PRI 지급기준일 item.WORK_DT 실제지급일 item.DIVIDEND_DT');
  const solEntry = entry({ ...raw, contract }, { sourceId: 'sol_official_distribution_history_api', shortCode: '0005D0', productId: '211079', status: 'partial' });
  const output = convertDistributionHistoryResults({ rootDir: root, ledgerTexts: { solApi: JSON.stringify(solEntry) } });
  assert.equal(output.sourceResult.records.length, 1);
  assert.equal(output.sourceResult.records[0].status, 'partial');
  assert.deepEqual(output.sourceResult.records[0].fields['distribution.history'][0], { exDate: null, recordDate: '2025-12-30', payDate: '2026-01-02', amount: 13, currency: 'KRW', perUnit: null });
  assert.equal(output.sourceResult.records[0].provenance.contractContentHash, contract.hash);
  assert.equal(output.report.sources.solApi.perShareBasisUnknownRecordCount, 1);
  assert.equal(output.sourceResult.quarantine.count, 0);
});

test('converter reports TIGER popup-only and WON empty-table unavailability separately', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-distribution-history-'));
  const tigerRaw = stored(root, 'raw/tiger.html', '<div class="pop-header-title">분배금현황</div><div id="dividendPopContainer"></div><script>javascript:openDividend()</script>');
  const wonRaw = stored(root, 'raw/won.html', wonTable(''));
  const output = convertDistributionHistoryResults({ rootDir: root, ledgerTexts: {
    tiger: JSON.stringify(entry(tigerRaw, { sourceId: 'issuer_tiger_product', shortCode: '102110' })),
    won: JSON.stringify(entry(wonRaw, { sourceId: 'won_official_product_html', shortCode: '444490' })),
  } });
  assert.equal(output.sourceResult.records.length, 0);
  assert.equal(output.report.sources.tiger.unavailableReasons.history_is_external_popup_not_present_in_saved_html, 1);
  assert.equal(output.report.sources.won.unavailableReasons.history_table_has_no_explicit_actual_rows, 1);
});

test('KoAct JSON parser emits only explicit actual dates and amounts without currency or per-unit inference', () => {
  const body = JSON.stringify({ info: { divideList: [
    { BASIC_D: '20260630', PAY_D: '20260702', DIVID_A: 83, TAX_DIVID_A: 23 },
    { BASIC_D: '20260731', PAY_D: '20260804', DIVID_A: 25, TAX_DIVID_A: 25 },
    { BASIC_D: '20260529', PAY_D: '20260602', DIVID_A: 0, TAX_DIVID_A: 0 },
  ], product: { dividRemark: '\ub9e4\uc6d4 \ub9c8\uc9c0\ub9c9 \uc601\uc5c5\uc77c' } } });
  const parsed = parseKoactDistributionHistoryJson(body, { retrievedAt: '2026-07-21T00:00:00.000Z' });
  assert.deepEqual(parsed.events, [{ exDate: null, recordDate: '2026-06-30', payDate: '2026-07-02', amount: 83, currency: null, perUnit: null }]);
  assert.equal(parsed.evidence.selector, '$.info.divideList[*]');
  assert.deepEqual(parsed.rejectedRows.map((row) => row.reason), ['future_payment_not_actual', 'amount_missing_or_invalid']);
});

test('converter emits KoAct JSON history with hash and JSONPath evidence and reports TheJ schedule-only HTML unavailable', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-distribution-history-'));
  const koactRaw = stored(root, 'raw/koact.json', JSON.stringify({ info: { divideList: [{ BASIC_D: '20260630', PAY_D: '20260702', DIVID_A: 83 }] } }));
  const thejRaw = stored(root, 'raw/thej.html', '<div class="b-article__tit">\ubd84\ubc30\uae08\uc9c0\uae09</div><div>\uc9c0\uae09\uae30\uc900\uc77c: \ub9e4 1\uc6d4, 4\uc6d4, 7\uc6d4, 10\uc6d4</div><button>\ubd84\ubc30\uae08 \ud604\ud669</button>');
  const output = convertDistributionHistoryResults({ rootDir: root, ledgerTexts: {
    koact: JSON.stringify(entry(koactRaw, { sourceId: 'koact_official_product_api', shortCode: '495230' })),
    thej: JSON.stringify(entry(thejRaw, { sourceId: 'thej_official_product_html', shortCode: '0053M0' })),
  } });
  assert.equal(output.sourceResult.records.length, 1);
  assert.equal(output.sourceResult.records[0].status, 'partial');
  assert.equal(output.sourceResult.records[0].fields['distribution.history'][0].currency, null);
  assert.equal(output.sourceResult.records[0].fields['distribution.history'][0].perUnit, null);
  assert.equal(output.sourceResult.records[0].evidence['distribution.history'].selector, '$.info.divideList[*]');
  assert.equal(output.sourceResult.records[0].provenance.contentHash, koactRaw.hash);
  assert.equal(output.report.sources.thej.unavailableReasons.no_history_table_in_saved_html, 1);
});
