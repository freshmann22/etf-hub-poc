import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pythonRuntime() {
  const candidates = process.platform === 'win32'
    ? [['py', ['-3']], ['python', []]]
    : [['python3', []], ['python', []]];
  return candidates.find(([command, prefix]) => {
    const result = spawnSync(command, [...prefix, '-c', 'import sys'], {
      cwd: ROOT,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      windowsHide: true,
    });
    return !result.error && result.status === 0;
  }) || null;
}

const RUNTIME = pythonRuntime();

function parseSemantic(pages) {
  assert.ok(RUNTIME, 'Python runtime unavailable');
  const [command, prefix] = RUNTIME;
  const source = String.raw`
import importlib.util
import json
import sys
from pathlib import Path

path = Path('scripts/metadata-v2/dart_pdf_semantic.py')
spec = importlib.util.spec_from_file_location('dart_pdf_semantic', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
result = module.parse_semantic_fields(json.loads(sys.argv[1]))
print(json.dumps(result, ensure_ascii=True))
`;
  const result = spawnSync(command, [...prefix, '-c', source, JSON.stringify(pages)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function assertEvidence(field, { heading, page = 1 } = {}) {
  assert.ok(field && typeof field === 'object');
  assert.equal(typeof field.value, 'string');
  assert.ok(field.value.length > 0);
  assert.equal(field.sectionHeading, heading);
  assert.equal(typeof field.snippet, 'string');
  assert.deepEqual(field.sourceEntries, [`pdf:p${page}`]);
  assert.equal(typeof field.rule, 'string');
  assert.ok(field.rule.length > 0);
}

test('semantic parser returns only the complete objective clause after an explicit heading', (t) => {
  if (!RUNTIME) return t.skip('Python runtime unavailable');
  const objective = '이 투자신탁은 국내 주식을 주된 투자대상자산으로 하며, KOSPI 200 지수를 기초지수로 하여 순자산가치의 변동률이 기초지수의 변동률과 유사하도록 운용함을 목적으로 합니다.';
  const result = parseSemantic([
    `1. 투자목적 ${objective} 2. 투자전략 파생상품을 활용하며 환율변동위험에 노출될 수 있습니다. ${'후속 설명 '.repeat(100)}`,
  ]);

  assert.deepEqual(Object.keys(result.fields).sort(), [
    'benchmarkDescription',
    'benchmarkName',
    'distributionFrequency',
    'distributionSchedule',
    'investmentObjective',
  ]);
  assertEvidence(result.fields.investmentObjective, { heading: '투자목적' });
  assert.equal(result.fields.investmentObjective.value, objective);
  assert.ok(result.fields.investmentObjective.snippet.length < 500);
  assert.doesNotMatch(result.fields.investmentObjective.value, /투자전략|파생상품|위험/);
  assert.ok(result.diagnostics && typeof result.diagnostics === 'object');
});

test('semantic parser rejects objective words in disclaimers, risk, and tracking-error paragraphs', (t) => {
  if (!RUNTIME) return t.skip('Python runtime unavailable');
  const result = parseSemantic([
    '주요 투자위험 이 투자신탁은 기초지수와 동일한 수익률 실현을 투자목적으로 하고 있으나, 추적오차와 괴리율 및 관련 비용으로 동일한 수익률이 실현되지 않을 수 있습니다. 투자목적의 달성을 보장하지 않습니다.',
    '투자전략에 따른 투자목적은 시장 상황에 따라 달성되지 않을 수 있으며 원금손실 위험이 있습니다.',
  ]);

  assert.equal(result.fields.investmentObjective, null);
});

test('semantic parser does not promote a table label injected inside an objective-looking sentence', (t) => {
  if (!RUNTIME) return t.skip('Python runtime unavailable');
  const result = parseSemantic([
    '이 투자신탁은 국내 주식을 대상으로 KOSPI 200 지수를 투자목적 기초지수로 하여 순자산가치의 변동률을 유사하도록 운용함을 목적으로 합니다. 투자전략 주식에 60% 이상 투자합니다.',
  ]);

  assert.equal(result.fields.investmentObjective, null);
});

test('semantic parser extracts benchmark identity and description but stops before performance tables', (t) => {
  if (!RUNTIME) return t.skip('Python runtime unavailable');
  const result = parseSemantic([
    '※ 비교지수: KOSPI 200 지수 지수소개 한국거래소가 유가증권시장 대표 종목으로 구성하여 산출하고 발표하는 지수입니다. 투자실적 최근 1년 비교지수(%) 12.30 연평균 수익률 8.10 수익률 변동성 15.20',
  ]);

  assertEvidence(result.fields.benchmarkName, { heading: '비교지수' });
  assertEvidence(result.fields.benchmarkDescription, { heading: '지수소개' });
  assert.equal(result.fields.benchmarkName.value, 'KOSPI 200 지수');
  assert.match(result.fields.benchmarkDescription.value, /한국거래소.*산출.*발표/);
  assert.doesNotMatch(result.fields.benchmarkDescription.value, /투자실적|최근 1년|연평균|변동성|12\.30/);
  assert.ok(result.fields.benchmarkDescription.snippet.length < 500);
});

test('semantic parser rejects benchmark labels that occur only in performance tables and fee footnotes', (t) => {
  if (!RUNTIME) return t.skip('Python runtime unavailable');
  const result = parseSemantic([
    '투자실적 기간 최근 1년 최근 3년 설정일 이후 펀드(%) 10.2 8.1 7.4 비교지수(%) 11.0 8.8 7.9 연평균 수익률 수익률 변동성 ※ 비교지수 성과에는 투자신탁에 부과되는 보수 및 비용이 반영되지 않았습니다.',
  ]);

  assert.equal(result.fields.benchmarkName, null);
  assert.equal(result.fields.benchmarkDescription, null);
});

test('semantic parser returns distribution evidence only from an explicit policy section', (t) => {
  if (!RUNTIME) return t.skip('Python runtime unavailable');
  const result = parseSemantic([
    '분배금 지급기준일: 매월 마지막 영업일. 분배금 지급시기: 지급기준일 익영업일로부터 제7영업일 이내에 지급합니다. 투자실적 분배 전후 기준가격은 달라질 수 있습니다.',
  ]);

  assertEvidence(result.fields.distributionSchedule, { heading: '분배에 관한 사항' });
  assertEvidence(result.fields.distributionFrequency, { heading: '분배주기' });
  assert.match(result.fields.distributionSchedule.value, /마지막 영업일/);
  assert.doesNotMatch(result.fields.distributionSchedule.value, /투자실적|기준가격/);
  assert.equal(result.fields.distributionFrequency.value, 'monthly');
});

test('semantic evidence retains the selected page and is not a fixed 500-character window', (t) => {
  if (!RUNTIME) return t.skip('Python runtime unavailable');
  const objective = '이 집합투자기구는 국내 채권을 주된 투자대상자산으로 하며, 비교지수 대비 초과성과를 달성하도록 운용함을 목적으로 합니다.';
  const result = parseSemantic([
    '표지 및 중요 안내. 투자목적의 달성을 보장하지 않으며 원금손실 위험이 있습니다.',
    `1. 투자목적 ${objective} 2. 투자전략 ${'전략 상세 '.repeat(120)}`,
  ]);

  assertEvidence(result.fields.investmentObjective, { heading: '투자목적', page: 2 });
  assert.equal(result.fields.investmentObjective.value, objective);
  assert.equal(result.fields.investmentObjective.snippet, objective);
  assert.ok(result.fields.investmentObjective.snippet.length < 500);
});
