export function assertFullUniverse({ expectedCount, actualCodes, operation = 'canonical tagging write' }) {
  const codes = actualCodes instanceof Set ? actualCodes : new Set(actualCodes || []);
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) throw new Error(`${operation}: invalid expected universe count`);
  if (codes.size !== expectedCount) {
    throw new Error(`${operation} refused: stale/partial input has ${codes.size} ETFs; canonical universe requires ${expectedCount}`);
  }
  return true;
}
