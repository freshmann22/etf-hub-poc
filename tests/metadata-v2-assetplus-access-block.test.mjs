import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reportPath = new URL('../data/reports/metadata-v2/assetplus-product-access-block.json', import.meta.url);
const rawPath = new URL('../data/raw/metadata-v2/assetplus-policy/robots.txt', import.meta.url);

test('AssetPlus preflight blocks all product calls on the generic robots rule', () => {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.issuer.inventoryCount, 9);
  assert.equal(report.robots.httpStatus, 200);
  assert.match(report.robots.observed, /User-agent:\s*\*[\s\S]*Disallow:\s*\//i);
  assert.equal(report.decision.status, 'blocked');
  assert.equal(report.scope.productListCalls, 0);
  assert.equal(report.scope.productDetailCalls, 0);
  assert.equal(report.decision.canaryAttemptedCount, 0);
  assert.equal(report.decision.converterRecordCount, 0);
});

test('AssetPlus robots evidence is immutable and hash verified', () => {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const raw = readFileSync(rawPath, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(Buffer.byteLength(raw), report.robots.raw.bytes);
  assert.equal(createHash('sha256').update(raw).digest('hex'), report.robots.raw.hash);
  assert.equal(raw.trim(), report.robots.observed);
});

test('Yeti-specific allow does not override the generic collector block', () => {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.match(report.robots.observed, /User-agent:\s*Yeti[\s\S]*Allow:\s*\//i);
  assert.equal(report.decision.reason, 'robots_disallow_all_for_generic_user_agent');
  assert.equal(report.terms.status, 'not_attempted_after_robots_block');
});
