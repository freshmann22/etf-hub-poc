import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDartDocument } from '../scripts/metadata-v2/providers/dart-document-parser.mjs';

function entries(xml) { return new Map([['document.xml', Buffer.from(xml)]]); }

test('extracts cover-coded official identity with provenance and conservative name flags', () => {
  const parsed = parseDartDocument(entries(`
    <DOCUMENT><COMPANY-NAME>테스트운용</COMPANY-NAME><BODY><COVER>
    <TE ACODE="FUND_NAME">테스트 KODEX 반도체레버리지증권상장지수투자신탁[주식-파생형]</TE>
    <TE ACODE="FUND_TRD">테스트운용 주식회사</TE></COVER>
    <LIBRARY><SECTION-1><TITLE>[ 본 문 ]</TITLE></SECTION-1></LIBRARY></BODY></DOCUMENT>`));
  assert.equal(parsed.fields.officialName.value, '테스트 KODEX 반도체레버리지증권상장지수투자신탁[주식-파생형]');
  assert.equal(parsed.fields.issuer.value, '테스트운용 주식회사');
  assert.equal(parsed.fields.leveraged, undefined);
  assert.equal(parsed.fields.flags.leveraged.value, true);
  assert.equal(parsed.fields.flags.derivative.value, true);
  assert.equal(parsed.fields.flags.inverse, null);
  assert.equal(parsed.fields.investmentObjective, null);
  assert.equal(parsed.diagnostics.coverOnly, true);
  assert.ok(parsed.fields.officialName.sectionHeading);
  assert.ok(parsed.fields.officialName.snippet);
});

test('extracts body fields only from explicit substantive section headings', () => {
  const parsed = parseDartDocument(entries(`
    <DOCUMENT><BODY><COVER><TE ACODE="FUND_NAME">테스트 ETF</TE></COVER><LIBRARY>
    <SECTION-1><TITLE>제2부. 집합투자기구의 투자목적</TITLE><P>이 투자신탁은 주식에 투자하여 장기 자본수익을 추구합니다. 기초지수인 ‘테스트 100 지수’를 추종합니다.</P></SECTION-1>
    <SECTION-2><TITLE>이익 분배</TITLE><P>회계기간 종료일을 기준으로 분배금을 지급할 수 있습니다.</P></SECTION-2>
    </LIBRARY></BODY></DOCUMENT>`));
  assert.match(parsed.fields.investmentObjective.value, /장기 자본수익/);
  assert.equal(parsed.fields.benchmarkName.value, '테스트 100 지수');
  assert.match(parsed.fields.distributionPolicy.value, /분배금/);
  assert.equal(parsed.diagnostics.coverOnly, false);
});

test('does not turn absent structure keywords into false booleans', () => {
  const parsed = parseDartDocument(entries('<DOCUMENT><BODY><COVER><TE ACODE="FUND_NAME">일반 주식 ETF</TE></COVER></BODY></DOCUMENT>'));
  assert.deepEqual(parsed.fields.flags, { derivative: null, leveraged: null, inverse: null, synthetic: null, currencyHedged: null });
});
