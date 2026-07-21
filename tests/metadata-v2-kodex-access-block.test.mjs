import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const report = JSON.parse(readFileSync(new URL('../data/reports/metadata-v2/kodex-product-access-block.json', import.meta.url), 'utf8'));

test('KODEX access report stops before product requests when policy endpoints are rate-limited', () => {
  assert.equal(report.issuer.inventoryCount, 238);
  assert.equal(report.probeContract.productDetailRequests, 0);
  assert.equal(report.probeContract.canaryRequests, 0);
  assert.equal(report.probeContract.fullCollectionRequests, 0);
  assert.equal(report.decision.status, 'blocked_before_product_request');
  assert.equal(report.decision.canaryAllowed, false);
  assert.equal(report.decision.fullCollectionAllowed, false);
  assert.ok(report.observations.every((row) => row.httpStatus === 429));
  assert.equal(report.probeContract.challengeBypassAttempted, false);
});
