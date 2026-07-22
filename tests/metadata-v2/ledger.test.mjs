import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResumableLedger } from '../../scripts/metadata-v2/lib/ledger.js';

test('ledger resumes retryable work and reruns parser upgrades', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-metadata-v2-ledger-'));
  let clock = new Date('2026-07-21T00:00:00.000Z');
  const ledger = new ResumableLedger(join(root, 'state.json'), { now: () => clock });
  assert.equal(ledger.shouldRun('issuer', '0000D0', { parserVersion: '1' }), true);
  ledger.claim('issuer', '0000D0', { parserVersion: '1' });
  ledger.fail('issuer', '0000D0', new Error('429'), { retryable: true, retryAfterMs: 1000 });
  assert.equal(ledger.shouldRun('issuer', '0000D0', { parserVersion: '1' }), false);
  clock = new Date('2026-07-21T00:00:02.000Z');
  assert.equal(ledger.shouldRun('issuer', '0000D0', { parserVersion: '1' }), true);
  ledger.claim('issuer', '0000D0', { parserVersion: '1' });
  ledger.complete('issuer', '0000D0', { rawHash: 'a'.repeat(64) });
  assert.equal(ledger.shouldRun('issuer', '0000D0', { parserVersion: '1' }), false);
  assert.equal(ledger.shouldRun('issuer', '0000D0', { parserVersion: '2' }), true);

  const reloaded = new ResumableLedger(join(root, 'state.json'), { now: () => clock });
  assert.equal(reloaded.get('issuer', '0000D0').attempts, 2);
});

test('non-retryable failure stays terminal', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-metadata-v2-ledger-'));
  const ledger = new ResumableLedger(join(root, 'state.json'));
  ledger.claim('seibro', '069500', { parserVersion: '1' });
  ledger.fail('seibro', '069500', new Error('parse drift'), { retryable: false });
  assert.equal(ledger.shouldRun('seibro', '069500', { parserVersion: '1' }), false);
});
