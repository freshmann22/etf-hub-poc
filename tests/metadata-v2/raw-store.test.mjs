import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppendOnlyRawStore } from '../../scripts/metadata-v2/lib/raw-store.js';

test('raw store creates content-addressed immutable snapshots and append-only manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-metadata-v2-raw-'));
  const store = new AppendOnlyRawStore(root, { now: () => new Date('2026-07-21T01:00:00.000Z') });
  const first = store.put({ sourceId: 'issuer', key: '0000D0', content: 'alpha', extension: 'html', metadata: { parserVersion: '1' } });
  const same = store.put({ sourceId: 'issuer', key: '0000D0', content: 'alpha', extension: 'html', metadata: { parserVersion: '1' } });
  const changed = store.put({ sourceId: 'issuer', key: '0000D0', content: 'beta', extension: 'html', metadata: { parserVersion: '1' } });
  assert.equal(first.path, same.path);
  assert.notEqual(first.path, changed.path);
  assert.equal(readFileSync(join(root, first.path), 'utf8'), 'alpha');
  assert.equal(readFileSync(join(root, 'manifest.jsonl'), 'utf8').trim().split('\n').length, 3);
});

test('raw store rejects path traversal segments', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-metadata-v2-raw-'));
  const store = new AppendOnlyRawStore(root);
  assert.throws(() => store.put({ sourceId: '../escape', key: 'x', content: 'bad' }), /invalid sourceId/);
});
