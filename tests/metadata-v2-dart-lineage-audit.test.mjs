import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDartLineage, sanitizeSourceResult } from '../scripts/metadata-v2/audit-dart-lineage.mjs';

const row = (etfCode, officialName, hash = etfCode.padEnd(64, 'a')) => ({
  etfCode,
  receptionNo: '20260101000001',
  source: { rawSha256: hash, viewerUrl: 'https://dart.fss.or.kr/report/download.do' },
  extraction: { fields: { officialName: officialName ? { value: officialName } : null } },
});

const fixtures = (rows, reportNameByCode) => ({
  disclosureIndex: { rows: rows.map((item) => ({ shortCode: item.etfCode, issuerId: 'issuer', match: { reportName: reportNameByCode[item.etfCode] } })) },
  canonical: { records: rows.map((item) => ({ universeKey: item.etfCode, identity: { shortCode: item.etfCode, officialName: item.extraction.fields.officialName?.value, issuerId: 'issuer' } })) },
});

test('lineage audit passes exact products and quarantines prefix collisions', () => {
  const rows = [
    row('490090', 'TIGER 미국AI빅테크10', 'b'.repeat(64)),
    row('493810', 'TIGER 미국AI빅테크10타겟데일리커버드콜', 'b'.repeat(64)),
    row('458750', 'TIGER 미국배당커버드콜'),
  ];
  const context = fixtures(rows, {
    '490090': 'TIGER 미국AI빅테크10타겟데일리커버드콜 투자설명서',
    '493810': 'TIGER 미국AI빅테크10타겟데일리커버드콜 투자설명서',
    '458750': 'TIGER 미국배당커버드콜 투자설명서',
  });
  const report = auditDartLineage({ rows }, context);
  assert.equal(report.items.find((item) => item.etfCode === '490090').severity, 'high');
  assert.equal(report.items.find((item) => item.etfCode === '493810').severity, 'pass');
  assert.equal(report.items.find((item) => item.etfCode === '458750').severity, 'pass');
  assert.equal(report.summary.duplicateHashGroupCount, 1);
});

test('audited source retains row accounting while removing high-risk fields', () => {
  const rows = [row('490090', 'TIGER 미국AI빅테크10'), row('493810', 'TIGER 미국AI빅테크10커버드콜')];
  const context = fixtures(rows, { '490090': 'TIGER 미국AI빅테크10커버드콜 투자설명서', '493810': 'TIGER 미국AI빅테크10커버드콜 투자설명서' });
  const audit = auditDartLineage({ rows }, context);
  const source = { source: { parserVersion: 'v1' }, records: [{ shortCode: '490090', status: 'ok', fields: { 'distribution.frequency': 'monthly' }, evidence: {}, provenance: {} }] };
  const output = sanitizeSourceResult(source, audit);
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].status, 'unavailable');
  assert.deepEqual(output.records[0].fields, {});
  assert.equal(output.health.lineageAudit.highRiskRecordCount, 1);
});
