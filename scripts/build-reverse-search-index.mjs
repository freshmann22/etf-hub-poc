import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const universePath = resolve(
  repoRoot,
  "data/tagging/etf-universe-index-names.json"
);
const metadataPath = resolve(repoRoot, "data/normalized/etf-metadata-v2.json");
const outPath = resolve(repoRoot, "public/data/reverse-search-index.json");

const universe = JSON.parse(readFileSync(universePath, "utf8"));
const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));

// Index metadata records by identity.shortCode for investmentObjective lookup.
const invObjByCode = new Map();
for (const record of metadata.records ?? []) {
  const code = record?.identity?.shortCode;
  if (code == null) continue;
  invObjByCode.set(String(code), record?.product?.investmentObjective);
}

const cleanString = (value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null") return undefined;
  return trimmed;
};

const entries = [];
for (const item of universe.items ?? []) {
  if (item?.etfCode == null) continue;
  const code = String(item.etfCode);
  if (code.trim() === "") continue;

  const entry = { code };

  const officialName = cleanString(item.name);
  if (officialName !== undefined) entry.officialName = officialName;

  const benchmarkName = cleanString(item.indexName);
  if (benchmarkName !== undefined) entry.benchmarkName = benchmarkName;

  const investmentObjective = cleanString(invObjByCode.get(code));
  if (investmentObjective !== undefined)
    entry.investmentObjective = investmentObjective;

  entries.push(entry);
}

entries.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

const output = {
  schemaVersion: "1.0",
  stablePolicy: "sorted-by-code-ascending;no-timestamp",
  source:
    "data/tagging/etf-universe-index-names.json + data/normalized/etf-metadata-v2.json",
  count: entries.length,
  etfs: entries,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

const withInvObj = entries.filter(
  (e) => e.investmentObjective !== undefined
).length;

console.log(`Wrote ${outPath}`);
console.log(`Total entries: ${entries.length}`);
console.log(`Entries with investmentObjective: ${withInvObj}`);
