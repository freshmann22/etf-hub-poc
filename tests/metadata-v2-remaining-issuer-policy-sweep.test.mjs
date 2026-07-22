import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const report = JSON.parse(readFileSync(new URL('../data/reports/metadata-v2/remaining-issuer-policy-sweep.json', import.meta.url), 'utf8'));

test('remaining issuer policy sweep is low-volume and never calls product details', () => {
  assert.equal(report.scope.issuerCount, 14);
  assert.equal(report.scope.inventoryCount, 54);
  assert.equal(report.scope.productDetailCalls, 0);
  assert.equal(report.scope.authenticationUsed, false);
  assert.equal(report.scope.certificateBypassUsed, false);
  assert.ok(report.issuers.every((issuer) => issuer.httpRequests >= 1 && issuer.httpRequests <= 3));
});

test('policy sweep classification totals are exhaustive and match inventory', () => {
  const decisions = Object.groupBy(report.issuers, (issuer) => issuer.decision);
  for (const key of ['eligible_for_canary', 'blocked', 'unresolved']) {
    assert.equal(decisions[key].length, report.summary[key].issuerCount);
    assert.equal(decisions[key].reduce((sum, issuer) => sum + issuer.inventoryCount, 0), report.summary[key].inventoryCount);
  }
  assert.equal(report.issuers.reduce((sum, issuer) => sum + issuer.inventoryCount, 0), report.scope.inventoryCount);
});

test('only issuers with observable allowed public paths are eligible for canary', () => {
  const eligible = report.issuers.filter((issuer) => issuer.decision === 'eligible_for_canary');
  assert.deepEqual(eligible.map((issuer) => issuer.issuerId), ['midas-asset-management', 'thej-asset-management', 'kcgi-asset-management']);
  assert.ok(eligible.every((issuer) => issuer.tls.status === 'authorized'));
  assert.ok(eligible.every((issuer) => issuer.robots.publicProductPathAllowed === true));
  assert.ok(eligible.every((issuer) => issuer.publicList.exists === true));
});

test('explicit generic robots denial and failed TLS are never marked eligible', () => {
  const db = report.issuers.find((issuer) => issuer.issuerId === 'db-asset-management');
  assert.equal(db.decision, 'blocked');
  assert.match(db.robots.rule, /Disallow:\s*\//);
  assert.ok(report.issuers.filter((issuer) => issuer.tls.status === 'unavailable').every((issuer) => issuer.decision === 'blocked'));
});
