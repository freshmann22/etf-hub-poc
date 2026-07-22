import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderFullAutoAuditHtml } from '../scripts/tagging/build-full-auto-audit-html.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('full auto audit HTML renders source-backed metrics, complete tables and print layout', () => {
  const dart = read('data/reports/metadata-v2/dart-lineage-audit.json');
  const taxonomy = read('data/reports/etf-taxonomy-full-auto-audit-v2.json');
  const readiness = read('data/reports/etf-taxonomy-data-readiness-v2.json');
  const html = renderFullAutoAuditHtml({ dart, taxonomy, readiness });
  assert.ok(html.includes('1,141개 ETF'));
  assert.equal((html.match(/data-search=/g) || []).length, dart.summary.severityCounts.high + taxonomy.actions.length);
  assert.ok(html.includes('@page{size:A4'));
  assert.ok(html.includes('window.print()'));
  assert.ok(html.includes('npm run audit:full:auto'));
  assert.ok(html.includes('구형 470종목 덮어쓰기 차단'));
});
