import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDartViewerContract, summarizeOfficialProductHtml } from '../scripts/metadata-v2/providers/official-product-html.mjs';

test('detects issuer product metadata signals without extracting scripts', () => {
  const result = summarizeOfficialProductHtml('<h1>RISE 테스트</h1><h2>KEY POINT</h2><p>기초지수 테스트 지수</p><p>분배금 지급 기준일</p><a>투자설명서</a><script>가짜상품</script>', 'RISE 테스트');
  assert.equal(result.expectedProductVisible, true);
  assert.deepEqual(result.fieldSignals, { productDescriptionOrObjective: true, benchmark: true, distributionPolicy: true, prospectusLinkLabel: true });
});

test('records DART viewer body length and public attachment-link absence', () => {
  const html = `node1['text'] = "[ 본 문 ]"; node1['eleId'] = "2"; node1['offset'] = "8050"; node1['length'] = "399";`;
  const result = parseDartViewerContract(html);
  assert.equal(result.bodyNode.length, 399);
  assert.equal(result.substantiveBodyAdvertised, false);
  assert.equal(result.publicAttachmentLinkCount, 0);
});
