import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeViewerBody, parseViewerMain } from '../scripts/metadata-v2/probe-dart-body-contract.mjs';

test('parses DART TOC node document identity without mixing attachment dcmNo values', () => {
  const html = `
    <script>
      var node1 = {};
      node1['text'] = "[ 본 문 ]";
      node1['rcpNo'] = "20260701000098";
      node1['dcmNo'] = "11457154";
      node1['eleId'] = "2";
      node1['offset'] = "8185";
      node1['length'] = "391";
      node1['dtd'] = "dart4.xsd";
      treeData.push(node1);
    </script>
    <select id="att">
      <option value="null">+첨부선택+</option>
      <option value="rcpNo=20260701000098&amp;dcmNo=11457155">2026.07.01 간이투자설명서(집합투자증권)</option>
    </select>`;

  const parsed = parseViewerMain(html);
  assert.equal(parsed.bodyNode.dcmNo, '11457154');
  assert.deepEqual(parsed.attachments, [{ rcpNo: '20260701000098', dcmNo: '11457155', label: '2026.07.01 간이투자설명서(집합투자증권)' }]);
});

test('recognizes substantive investment text and the official PDF download contract', () => {
  const html = `
    <p>이 투자신탁은 국내 채권에 투자하고 기초지수와 유사한 수익률을 실현하는 것을 목표로 운용합니다.</p>
    <a href="/report/download.do?dcmNo=11457155&amp;flNm=summary.pdf">간이투자설명서.pdf</a>`;

  const analyzed = analyzeViewerBody(html);
  assert.equal(analyzed.substantiveSignals.investmentMandate, true);
  assert.equal(analyzed.substantiveSignals.benchmark, true);
  assert.deepEqual(analyzed.downloadPaths, ['/report/download.do?dcmNo=11457155&flNm=summary.pdf']);
});
