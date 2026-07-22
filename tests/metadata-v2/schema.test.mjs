import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('metadata v2 schema is valid JSON and requires provenance-bearing records', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schemas/etf-metadata-v2.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(schema.required, ['schemaVersion', 'generatedAt', 'universeCount', 'records']);
  assert.ok(schema.$defs.record.required.includes('fieldCandidates'));
  assert.ok(schema.$defs.candidate.required.includes('provenance'));
  assert.equal(schema.$defs.provenance.properties.contentHash.pattern, '^[a-f0-9]{64}$');
});
