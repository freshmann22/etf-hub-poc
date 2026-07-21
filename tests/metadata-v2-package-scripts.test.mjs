import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('metadata:v2 package commands point to existing script files and have unique keys', () => {
  const root = resolve(import.meta.dirname, '..');
  const raw = readFileSync(resolve(root, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);
  const declaredKeys = [...raw.matchAll(/^\s*"(metadata:v2:[^"]+)"\s*:/gm)].map((match) => match[1]);
  assert.equal(new Set(declaredKeys).size, declaredKeys.length, 'duplicate metadata:v2 script key');
  for (const [name, command] of Object.entries(pkg.scripts).filter(([key]) => key.startsWith('metadata:v2:'))) {
    const match = command.match(/^node\s+(scripts\/[^\s"]+\.mjs)(?:\s|$)/);
    if (!match) continue;
    assert.ok(existsSync(resolve(root, match[1])), `${name} points to missing ${match[1]}`);
  }
});
