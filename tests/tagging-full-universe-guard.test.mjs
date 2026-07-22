import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFullUniverse } from '../scripts/tagging/lib/full-universe-guard.mjs';

test('full universe guard accepts the exact canonical shape', () => {
  assert.equal(assertFullUniverse({ expectedCount: 3, actualCodes: new Set(['A', 'B', 'C']) }), true);
});

test('full universe guard rejects stale partial input before canonical writes', () => {
  assert.throws(
    () => assertFullUniverse({ expectedCount: 1141, actualCodes: new Set(Array.from({ length: 470 }, (_, index) => String(index))) }),
    /stale\/partial input has 470 ETFs/,
  );
});
