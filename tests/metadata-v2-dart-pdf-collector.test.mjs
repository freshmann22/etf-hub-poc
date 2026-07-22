import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseCurrentAttachment } from '../scripts/metadata-v2/collect-dart-prospectus-pdfs.mjs';

test('DART PDF collector chooses the current short prospectus and ignores older corrections', () => {
  const attachments = [
    { rcpNo: '20260602000038', dcmNo: '11415373', label: '2026.06.02 [정정] 간이투자설명서(집합투자증권)' },
    { rcpNo: '20260526000002', dcmNo: '11398555', label: '2026.05.26 간이투자설명서(집합투자증권)' },
  ];
  assert.equal(chooseCurrentAttachment(attachments, '20260602000038').dcmNo, '11415373');
});

test('DART PDF collector never treats a non-short attachment as the prospectus PDF', () => {
  assert.equal(chooseCurrentAttachment([{ rcpNo: '1', dcmNo: '2', label: '효력발생안내' }], '1'), null);
});
