import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluateKiwoomAccess } from '../scripts/metadata-v2/diagnose-kiwoom-access.mjs';

function passingEvidence() {
  return {
    nodeBundled: { ok: true },
    nodeSystemCa: { ok: true },
    windowsNative: { ok: true },
    serverChain: { presentedCertificateCount: 2, verificationError: null },
    alternateHosts: [],
    robots: { ok: true, allowsProductRoute: true },
    terms: { ok: true, automatedCollectionRestrictionFound: false },
    publicProductContract: { verified: true },
  };
}

test('KIWOOM policy blocks before product requests when the server omits its intermediate', () => {
  const evidence = passingEvidence();
  evidence.nodeBundled = { ok: false, code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' };
  evidence.nodeSystemCa = { ok: false, code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' };
  evidence.windowsNative = { ok: false };
  evidence.serverChain = { presentedCertificateCount: 1, verificationError: 'unable to get local issuer certificate' };
  evidence.robots = { ok: false, allowsProductRoute: null };
  evidence.terms = { ok: false, automatedCollectionRestrictionFound: null };
  evidence.publicProductContract = { verified: false };
  const decision = evaluateKiwoomAccess(evidence);
  assert.equal(decision.status, 'blocked_before_product_request');
  assert.equal(decision.canaryAllowed, false);
  assert.equal(decision.fullCollectionAllowed, false);
  assert.ok(decision.reasons.includes('server_certificate_chain_incomplete'));
  assert.ok(decision.reasons.includes('robots_not_normally_verifiable'));
});

test('one-then-four canary is eligible only after every TLS, policy, and product-contract gate passes', () => {
  const decision = evaluateKiwoomAccess(passingEvidence());
  assert.equal(decision.status, 'eligible_for_one_then_four_canary');
  assert.equal(decision.canaryAllowed, true);
  assert.equal(decision.fullCollectionAllowed, false);
});

test('a normally verified official alternate endpoint may satisfy the TLS gate', () => {
  const evidence = passingEvidence();
  evidence.nodeBundled = { ok: false };
  evidence.nodeSystemCa = { ok: false };
  evidence.windowsNative = { ok: false };
  evidence.serverChain = { presentedCertificateCount: 1, verificationError: 'unable to get local issuer certificate' };
  evidence.alternateHosts = [{ host: 'official-alternate.example', ok: true, status: 200 }];
  const decision = evaluateKiwoomAccess(evidence);
  assert.equal(decision.canaryAllowed, true);
  assert.equal(decision.reasons.includes('server_certificate_chain_incomplete'), false);
});

test('generated KIWOOM access report records zero product and canary requests while blocked', () => {
  const report = JSON.parse(readFileSync(new URL('../data/reports/metadata-v2/kiwoom-product-access-block.json', import.meta.url), 'utf8'));
  assert.equal(report.issuer.inventoryCount, 68);
  assert.equal(report.probeContract.certificateVerificationDisabled, false);
  assert.equal(report.probeContract.ignoreCertificateErrorsUsed, false);
  assert.equal(report.probeContract.productDetailRequests, 0);
  assert.equal(report.probeContract.canaryRequests, 0);
  assert.equal(report.probeContract.fullCollectionRequests, 0);
  assert.equal(report.decision.status, 'blocked_before_product_request');
  assert.equal(report.decision.canaryAllowed, false);
  assert.equal(report.decision.fullCollectionAllowed, false);
  assert.equal(report.observations.serverChain.presentedCertificateCount, 1);
  assert.match(report.diagnosis.rootCause, /omits its Sectigo .* intermediate/);
});
