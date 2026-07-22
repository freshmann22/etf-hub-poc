import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const readText = (path) => readFileSync(path, 'utf8');
const jsFiles = readdirSync('src/js')
  .filter((fileName) => fileName.endsWith('.js'))
  .map((fileName) => `src/js/${fileName}`);
const reverseSearchJsFiles = readdirSync('modules/reverse-search/src')
  .filter((fileName) => fileName.endsWith('.js'))
  .map((fileName) => `modules/reverse-search/src/${fileName}`);
const scannedFiles = [
  'index.html',
  'modules/reverse-search/index.html',
  ...jsFiles,
  ...reverseSearchJsFiles,
].map((fileName) => ({
  fileName,
  text: readText(fileName),
}));

test('forbidden investment-inducement substrings do not appear in shipped HTML or JavaScript', () => {
  const forbiddenSubstrings = [
    '추천 ETF',
    'ETF 추천',
    '추천 테마',
    '추천드',
    '지금 사야',
    '매수 타이밍',
    '매도 타이밍',
    '상승 가능성이 높',
    '목표가격',
    '목표수익률',
    '자금 유입',
    '자금이 유입',
    '자금이 몰',
    '돈이 몰',
    '자금이 빠져',
  ];

  for (const { fileName, text } of scannedFiles) {
    for (const phrase of forbiddenSubstrings) {
      assert.ok(!text.includes(phrase), `${fileName} contains forbidden phrase: ${phrase}`);
    }
  }
});

test('index.html contains required sample notice and search placeholder copy', () => {
  const html = readText('index.html');

  assert.ok(html.includes('화면 내 정보는 PoC용 샘플 데이터입니다.'), 'index.html missing sample notice');
  assert.ok(html.includes('ETF, 종목, 테마를 검색해보세요'), 'index.html missing search placeholder');
});

test('viewport meta and horizontal overflow guard are present', () => {
  const html = readText('index.html');
  const css = readText('src/styles/main.css');

  assert.match(html, /<meta\b[^>]*name=["']viewport["'][^>]*content=["'][^"']*width=device-width/i, 'index.html missing viewport meta with width=device-width');
  assert.match(css, /(?:html|body)[^{]*\{[^}]*overflow-x\s*:\s*hidden\b/is, 'src/styles/main.css missing html/body overflow-x: hidden rule');
});

test('reverse-search module has a mobile viewport and horizontal overflow guard', () => {
  const html = readText('modules/reverse-search/index.html');
  const css = readText('modules/reverse-search/src/styles.css');

  assert.match(html, /<meta\b[^>]*name=["']viewport["'][^>]*content=["'][^"']*width=device-width/i,
    'reverse-search index missing viewport meta with width=device-width');
  assert.match(css, /(?:html|body|\.app-shell)[^{]*\{[^}]*overflow-x\s*:\s*(?:hidden|clip)\b/is,
    'reverse-search styles missing a horizontal overflow guard');
});

test('index.html has no buy, sell, or order buttons', () => {
  const html = readText('index.html');
  const forbiddenButtonPattern = /<button\b[^>]*>[\s\S]*?(?:매수|매도|주문)[\s\S]*?<\/button>/i;

  assert.doesNotMatch(html, forbiddenButtonPattern, 'index.html contains a buy/sell/order button');
});
