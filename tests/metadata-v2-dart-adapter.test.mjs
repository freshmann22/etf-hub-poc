import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCorpCodeXml } from '../scripts/metadata-v2/providers/dart-client.mjs';
import { isFullFundProspectus, matchLatestProspectus, normalizeDartText } from '../scripts/metadata-v2/providers/dart-match.mjs';

test('parses DART corporation XML without retaining unrelated content', () => {
  const rows = parseCorpCodeXml('<?xml version="1.0"?><result><list><corp_code>001</corp_code><corp_name>삼성자산운용(주)</corp_name><stock_code></stock_code><modify_date>20260701</modify_date></list></result>');
  assert.deepEqual(rows, [{ corpCode: '001', corpName: '삼성자산운용(주)', stockCode: null, modifyDate: '20260701' }]);
});

test('matches only full fund prospectuses and selects the latest filing', () => {
  const canary = { etfCode: '0190G0', name: 'KODEX 반도체타겟위클리커버드콜' };
  const disclosures = [
    { report_nm: '간이투자설명서(집합투자증권) (삼성 KODEX 반도체타겟위클리커버드콜증권상장지수투자신탁)', rcept_dt: '20260720', rcept_no: '20260720000003' },
    { report_nm: '투자설명서(집합투자증권) (삼성 KODEX 반도체타겟위클리커버드콜증권상장지수투자신탁)', rcept_dt: '20260601', rcept_no: '20260601000001' },
    { report_nm: '[기재정정]투자설명서(집합투자증권) (삼성 KODEX 반도체타겟위클리커버드콜증권상장지수투자신탁)', rcept_dt: '20260701', rcept_no: '20260701000002' },
  ];
  assert.equal(isFullFundProspectus(disclosures[0].report_nm), false);
  const result = matchLatestProspectus(canary, disclosures);
  assert.equal(result.matched, true);
  assert.equal(result.match.rcept_no, '20260701000002');
});

test('normalization tolerates legal prefixes and spacing while retaining product identity', () => {
  assert.ok(normalizeDartText('삼성 KODEX 200 증권상장지수투자신탁').includes(normalizeDartText('KODEX 200')));
});
