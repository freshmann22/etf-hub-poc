import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProgress, parseLatestLedger } from '../scripts/metadata-v2/build-dart-pdf-progress.mjs';

test('DART progress keeps the latest status and isolates malformed concurrent tail lines', () => {
  const text = [
    JSON.stringify({ universeKey: 'A', status: 'error' }),
    JSON.stringify({ universeKey: 'A', status: 'ok' }),
    JSON.stringify({ universeKey: 'B', status: 'quarantine' }),
    '{"universeKey":"C"',
  ].join('\n');
  const parsed = parseLatestLedger(text);
  assert.equal(parsed.latest.size, 2);
  assert.equal(parsed.latest.get('A').status, 'ok');
  assert.equal(parsed.malformedLineCount, 1);
});

test('DART progress counts only mapped index targets', () => {
  const index = { rows: [
    { universeKey: 'A', status: 'mapped' },
    { universeKey: 'B', status: 'mapped' },
    { universeKey: 'C', status: 'quarantine' },
  ] };
  const ledger = [
    JSON.stringify({ universeKey: 'A', status: 'ok' }),
    JSON.stringify({ universeKey: 'C', status: 'ok' }),
  ].join('\n');
  const report = buildProgress(index, ledger, '2026-01-01T00:00:00.000Z');
  assert.equal(report.metrics.targetCount, 2);
  assert.equal(report.metrics.attemptedCount, 1);
  assert.equal(report.metrics.successfulCount, 1);
  assert.equal(report.metrics.notAttemptedCount, 1);
  assert.equal(report.metrics.ledger.outOfScopeLatestCount, 1);
});
