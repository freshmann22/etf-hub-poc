import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSolDistributionHistoryJson, validateSolDividendJsContract } from '../scripts/metadata-v2/providers/sol-distribution-history.mjs';

test('SOL dividend JSON maps actual dates and amount but keeps per-share basis null', () => {
  const raw = JSON.stringify({ fundName: 'SOL 테스트', totalCount: 1, items: [{ FUND_CD: '211079', WORK_DT: '20251230', DIVIDEND_DT: '20260102', DIVIDEND_PRI: 13 }] });
  const parsed = parseSolDistributionHistoryJson(raw, { expectedProductId: '211079', retrievedAt: '2026-07-21T00:00:00Z' });
  assert.deepEqual(parsed.events, [{ exDate: null, recordDate: '2025-12-30', payDate: '2026-01-02', amount: 13, currency: 'KRW', perUnit: null }]);
  assert.equal(parsed.evidence.perUnitBasis, 'not_explicit_in_official_popup_header_or_json');
});

test('SOL dividend parser rejects mismatches, invalid values, and future payments', () => {
  const raw = JSON.stringify({ totalCount: 3, items: [{ FUND_CD: 'x', WORK_DT: '20251230', DIVIDEND_DT: '20260102', DIVIDEND_PRI: 13 }, { FUND_CD: '211079', WORK_DT: 'bad', DIVIDEND_DT: '20260102', DIVIDEND_PRI: 13 }, { FUND_CD: '211079', WORK_DT: '20261230', DIVIDEND_DT: '20270102', DIVIDEND_PRI: 13 }] });
  const parsed = parseSolDistributionHistoryJson(raw, { expectedProductId: '211079', retrievedAt: '2026-07-21T00:00:00Z' });
  assert.deepEqual(parsed.rejectedRows.map((row) => row.reason), ['fund_code_mismatch', 'record_date_missing_or_invalid', 'future_payment_not_actual']);
  assert.equal(parsed.events.length, 0);
});

test('SOL official popup JS contract does not claim a per-share distribution basis', () => {
  const js = 'url : "/api/etf/pds/dividend/" + fundCode; 지급기준일 item.WORK_DT 실제지급일 item.DIVIDEND_DT 분배금액(원) item.DIVIDEND_PRI 주당과세표준액(원)';
  assert.deepEqual(validateSolDividendJsContract(js), { endpointTemplate: '/api/etf/pds/dividend/{fundCode}', recordDateField: 'WORK_DT', payDateField: 'DIVIDEND_DT', amountField: 'DIVIDEND_PRI', currency: 'KRW', perUnit: null });
});
