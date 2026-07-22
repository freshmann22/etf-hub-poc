import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
// modules/reverse-search/tests -> repo root is three levels up.
const repoRoot = resolve(testDir, "..", "..", "..");

const indexPath = resolve(repoRoot, "public/data/reverse-search-index.json");
const universePath = resolve(
  repoRoot,
  "data/tagging/etf-universe-index-names.json"
);

const index = JSON.parse(readFileSync(indexPath, "utf8"));
const universe = JSON.parse(readFileSync(universePath, "utf8"));

test("count matches etfs array length", () => {
  assert.equal(index.count, index.etfs.length);
});

test("count matches canonical universe (items with etfCode)", () => {
  const universeCount = universe.items.filter(
    (item) => item.etfCode != null && String(item.etfCode).trim() !== ""
  ).length;
  assert.equal(index.count, universeCount);
});

test("all code values are unique", () => {
  const codes = index.etfs.map((e) => e.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("array is sorted ascending by code", () => {
  for (let i = 1; i < index.etfs.length; i++) {
    assert.ok(
      index.etfs[i - 1].code < index.etfs[i].code,
      `not sorted at ${i}: ${index.etfs[i - 1].code} >= ${index.etfs[i].code}`
    );
  }
});

test("487950 entry exists with Taiwan evidence", () => {
  const entry = index.etfs.find((e) => e.code === "487950");
  assert.ok(entry, "487950 entry missing");
  assert.ok(entry.officialName.includes("대만"));
  assert.ok(entry.benchmarkName.includes("Taiwan"));
});

test("no field is the string 'null' or empty string", () => {
  for (const entry of index.etfs) {
    for (const [key, value] of Object.entries(entry)) {
      assert.notEqual(value, "", `empty string at ${entry.code}.${key}`);
      assert.notEqual(value, "null", `literal null at ${entry.code}.${key}`);
    }
  }
});

test("every entry has officialName or benchmarkName", () => {
  for (const entry of index.etfs) {
    assert.ok(
      entry.officialName != null || entry.benchmarkName != null,
      `entry ${entry.code} has neither officialName nor benchmarkName`
    );
  }
});
