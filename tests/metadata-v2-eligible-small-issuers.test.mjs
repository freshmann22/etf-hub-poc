import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKcgiListHtml, parseKcgiProductHtml, parseThejProductHtml } from '../scripts/metadata-v2/providers/eligible-small-issuers.mjs';
import { reconcileSmallIssuer, validateStrictMetadata } from '../scripts/metadata-v2/collect-eligible-small-issuers.mjs';

test('KCGI singleton list mapping still requires product-page ticker identity', () => {
  const list = parseKcgiListHtml('<a href="/fund/etf-product.php?goPage=View&amp;idx=47" class="fund-item"><h3>\ucf00\uc774\uc528\uc9c0\uc544\uc774 KCGI \ubbf8\uad6dS&amp;P500 TOP10\uc99d\uad8c\uc0c1\uc7a5\uc9c0\uc218(\uc8fc\uc2dd)</h3></a>');
  const mapped = reconcileSmallIssuer([{ shortCode: '483570', name: 'KCGI \ubbf8\uad6dS&P500 TOP10' }], list);
  assert.equal(mapped[0].status, 'mapped');
  const parsed = parseKcgiProductHtml('<h1>\ucf00\uc774\uc528\uc9c0\uc544\uc774 KCGI \ubbf8\uad6dS&amp;P500 TOP10 \uc99d\uad8c\uc0c1\uc7a5\uc9c0\uc218(\uc8fc\uc2dd)</h1><div id="sec1"><p class="doc-txt">\ud22c\uc790\ubaa9\uc801</p></div><table><tr><th>\ubca4\uce58\ub9c8\ud06c</th><td>S&amp;P 500 TOP10</td></tr></table>', { expectedName: mapped[0].sourceName, expectedTicker: '483570' });
  assert.equal(parsed.identity.expectedNameMatches, true);
  assert.equal(parsed.identity.expectedTickerMatches, false);
});

test('TheJ parser extracts identity and all strict fields', () => {
  const html = '<div class="tit-area">\ub354\uc81c\uc774 \uc911\uc18c\ud615\ud3ec\ucee4\uc2a4\uc561\ud2f0\ube0c\uc99d\uad8c\uc0c1\uc7a5\uc9c0\uc218\ud22c\uc790\uc2e0\ud0c1[\uc8fc\uc2dd]</div><div class="subt-area">\ucf54\uc2a4\ud53c200\uc911\uc18c\ud615\uc8fc \uc9c0\uc218 \ucd94\uc885 ETF (0053M0)</div><article class="b-article"><div class="b-article__tit">\ud22c\uc790\uc804\ub7b5</div><div>\uc911\uc18c\ud615\uc8fc\uc5d0 \ud22c\uc790</div></article><article class="b-article"><div class="b-article__tit">\uae30\ucd08\uc9c0\uc218</div><div>KOSPI 200 MidSmall</div></article><article class="b-article"><div class="b-article__tit">\ubd84\ubc30\uae08\uc9c0\uae09</div><div>1,4,7,10\uc6d4</div></article>';
  const parsed = parseThejProductHtml(html, { expectedName: '\ub354\uc81c\uc774 \uc911\uc18c\ud615\ud3ec\ucee4\uc2a4\uc561\ud2f0\ube0c', expectedTicker: '0053M0' });
  const validation = validateStrictMetadata(parsed, 'a'.repeat(64), 'thej_official_product_html');
  assert.equal(validation.pass, true);
  assert.equal(validation.missingFields.length, 0);
});
