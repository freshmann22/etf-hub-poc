import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pythonRuntime() {
  const candidates = process.platform === 'win32'
    ? [['py', ['-3']], ['python', []]]
    : [['python3', []], ['python', []]];
  return candidates.find(([command, prefix]) => {
    const result = spawnSync(command, [...prefix, '-c', 'import sys'], { cwd: ROOT, windowsHide: true });
    return !result.error && result.status === 0;
  }) || null;
}

function pdfPythonRuntime() {
  const candidates = [];
  if (process.env.METADATA_V2_PYTHON) candidates.push([process.env.METADATA_V2_PYTHON, []]);
  const bundled = process.platform === 'win32'
    ? join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe')
    : join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'bin', 'python');
  if (existsSync(bundled)) candidates.push([bundled, []]);
  candidates.push(...(process.platform === 'win32'
    ? [['py', ['-3']], ['python', []]]
    : [['python3', []], ['python', []]]));
  const seen = new Set();
  return candidates.find(([command, prefix]) => {
    const key = `${command}\0${prefix.join('\0')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const result = spawnSync(command, [...prefix, '-c', 'import pdfplumber, pypdf'], {
      cwd: ROOT,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      windowsHide: true,
    });
    return !result.error && result.status === 0;
  }) || null;
}

test('DART PDF quality rules separate OCR need from layout-order disagreement and keep evidence local', (t) => {
  const runtime = pythonRuntime();
  if (!runtime) return t.skip('Python runtime unavailable');
  const [command, prefix] = runtime;
  const source = String.raw`
import importlib.util
import sys
import types
from pathlib import Path

pdfplumber = types.ModuleType('pdfplumber')
pypdf = types.ModuleType('pypdf')
pypdf.PdfReader = object
sys.modules['pdfplumber'] = pdfplumber
sys.modules['pypdf'] = pypdf

path = Path('scripts/metadata-v2/dart_pdf_canary.py')
spec = importlib.util.spec_from_file_location('dart_pdf_canary', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

assert module.normalize('투자\x00목적\x07 및\n투자전략') == '투자 목적 및 투자전략'
assert module.normalize('A\uf09e B\uf09f C\uf0d8 D\uf06c E') == 'A • B • C ▶ D • E'
assert module.normalize('unknown\ue123glyph') == 'unknown\ue123glyph'

plumber_pages = [
    ('투자 목적 국내 주식에 투자하여 초과 성과를 목표로 운용합니다 자산 가치 수익률 위험 관리 ' * 25),
    ('비교 지수 KOSPI 200 중소형주 투자 전략 신탁 재산 운용 포트폴리오 종목 비중 ' * 25),
]
private_use_quality = module.native_text_quality([plumber_pages[0] + ('\uf09f' * 10)])
assert private_use_quality['privateUseCharacterCount'] == 10
assert '\uf09f' not in module.normalize(plumber_pages[0] + ('\uf09f' * 10))
pypdf_pages = [
    ('관리 위험 수익률 가치 자산 운용합니다 목표로 성과를 초과 투자하여 주식에 국내 목적 투자 ' * 25),
    ('비중 종목 포트폴리오 운용 재산 신탁 전략 투자 중소형주 200 KOSPI 지수 비교 ' * 25),
]
quality = module.assess_extraction_quality(plumber_pages, pypdf_pages)
assert quality['agreement'] < module.PASS_CRITERIA['minimumExtractorAgreement']
assert quality['nativeTextUsable'] is True
assert quality['ocrRequired'] is False
assert quality['layoutOrderDisagreement'] is True
assert quality['reviewReasons'] == ['layout_order_disagreement']

unusable = module.assess_extraction_quality(['투자 목적'], ['투자 목적'])
assert unusable['nativeTextUsable'] is False
assert unusable['ocrRequired'] is True
assert 'native_text_unusable_requires_ocr' in unusable['reviewReasons']

low_coverage_pages = [plumber_pages[0], '', '', '', '']
low_coverage = module.native_text_quality(low_coverage_pages)
assert low_coverage['textLength'] >= module.MIN_NATIVE_TEXT_LENGTH
assert low_coverage['pageCoverage'] == 0.2
assert low_coverage['usableNativeText'] is False

punctuation = module.native_text_quality([('!@#$%^&*()[]{}.,;:' * 80)])
assert punctuation['textLength'] >= module.MIN_NATIVE_TEXT_LENGTH
assert punctuation['tokenContentRatio'] == 0
assert punctuation['usableNativeText'] is False

repeated_garbage = module.native_text_quality(['A' * 1000])
assert repeated_garbage['textLength'] == 1000
assert repeated_garbage['tokenContentRatio'] == 1
assert repeated_garbage['uniqueAlphanumericCharacterCount'] == 1
assert repeated_garbage['uniqueTokenCount'] == 1
assert repeated_garbage['usableNativeText'] is False

replacement_garbage = module.native_text_quality([plumber_pages[0] + ('\ufffd' * 1000)])
assert replacement_garbage['replacementGlyphRatio'] > module.MAX_REPLACEMENT_GLYPH_RATIO
assert replacement_garbage['mojibakeSignalRatio'] > module.MAX_MOJIBAKE_SIGNAL_RATIO
assert replacement_garbage['usableNativeText'] is False

control_garbage = module.native_text_quality([plumber_pages[0] + ('\x00' * 3000)])
assert control_garbage['controlCharacterRatio'] > module.MAX_CONTROL_CHARACTER_RATIO
assert control_garbage['usableNativeText'] is False

one_usable = module.assess_extraction_quality(plumber_pages, ['A' * 1000])
assert one_usable['pdfplumber']['usableNativeText'] is True
assert one_usable['pypdf']['usableNativeText'] is False
assert one_usable['nativeTextUsable'] is True
assert one_usable['ocrRequired'] is False

both_unusable = module.assess_extraction_quality(['A' * 1000], [('?' * 1000)])
assert both_unusable['nativeTextUsable'] is False
assert both_unusable['ocrRequired'] is True

positive_page = (
    ('위험 고지 ' * 120)
    + '이 투자신탁은 액티브상장지수펀드로 비교지수 대비 초과성과를 달성하는 것을 목표로 운용하며 '
      '신탁재산의 60% 이상을 상장 주식에 투자할 계획입니다. '
      '투자목적 및 이 투자신탁은 비교지수의 변화를 초과하도록 투자신탁재산을 운용 '
      '투자전략 함을 목적으로 합니다. ※ 비교지수 : KOSPI 200 중소형주*100%'
)
positive = module.evidence_for_pages([positive_page])
assert positive['objective']['found'] is True
assert positive['strategy']['found'] is True
assert positive['benchmark']['found'] is True
assert positive['objective']['selectedPage'] == 1
assert '\x00' not in positive['objective']['snippet']

negative_page = (
    '주요 투자 위험 투자전략에 따른 투자목적 또는 성과목표는 반드시 실현된다는 보장은 없습니다. '
    '투자 목적과 투자 전략이라는 표현은 손실 가능성을 설명하기 위한 위험 고지입니다.'
)
negative = module.evidence_for_pages([negative_page])
assert negative['objective']['found'] is False
assert negative['strategy']['found'] is False

people_page = (
    '책임운용전문인력이란 해당 집합투자기구의 투자전략 수립 및 투자 의사결정에 핵심 역할을 수행하며 '
    '집합투자기구의 투자목적 및 운용전략 등에 영향을 미치는 운용전문인력을 의미합니다.'
)
people = module.evidence_for_pages([people_page])
assert people['objective']['found'] is False
assert people['strategy']['found'] is False
`;
  const result = spawnSync(command, [...prefix, '-c', source], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('four audited native-text PDFs remain parsed with review warnings and substantive page-one evidence', (t) => {
  const reportPath = resolve(ROOT, 'data/reports/metadata-v2/dart-pdf-batch-extraction.json');
  if (!existsSync(reportPath)) return t.skip('full-batch extraction report unavailable');
  const runtime = pdfPythonRuntime();
  if (!runtime) return t.skip('Python PDF runtime unavailable');

  const codes = ['0053M0', '433250', '470310', '476000'];
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const rows = new Map(report.rows.map((row) => [row.etfCode, row]));
  for (const code of codes) {
    assert.ok(rows.has(code), `missing extraction row for ${code}`);
    assert.ok(existsSync(resolve(ROOT, rows.get(code).source.rawSnapshotPath)), `missing raw PDF for ${code}`);
  }
  for (const script of ['scripts/metadata-v2/dart_pdf_canary.py', 'scripts/metadata-v2/extract_dart_pdf_batch.py']) {
    const source = readFileSync(resolve(ROOT, script), 'utf8');
    for (const code of codes) assert.equal(source.includes(code), false, `${script} contains a code-specific exception for ${code}`);
  }

  const [command, prefix] = runtime;
  const source = String.raw`
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, 'scripts/metadata-v2')
from dart_pdf_canary import assess_extraction_quality, evidence_for_pages, extract_pdfplumber, extract_pypdf, normalize

root = Path.cwd()
codes = {'0053M0', '433250', '470310', '476000'}
report = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
rows = {row['etfCode']: row for row in report['rows'] if row['etfCode'] in codes}
assert set(rows) == codes

def inspect(code):
    path = root / rows[code]['source']['rawSnapshotPath']
    plumber_pages = extract_pdfplumber(path)
    pypdf_pages = extract_pypdf(path)
    quality = assess_extraction_quality(plumber_pages, pypdf_pages)
    evidence = evidence_for_pages(plumber_pages)
    assert quality['nativeTextUsable'] is True, (code, quality)
    assert quality['ocrRequired'] is False, (code, quality)
    assert quality['layoutOrderDisagreement'] is True, (code, quality)
    assert quality['reviewRequired'] is True, (code, quality)
    assert quality['reviewReasons'] == ['layout_order_disagreement'], (code, quality)
    for field in ('objective', 'strategy', 'benchmark'):
        assert evidence[field]['found'] is True, (code, field, evidence[field])
        assert evidence[field]['selectedPage'] == 1, (code, field, evidence[field])
        assert evidence[field]['snippet'] and '\x00' not in evidence[field]['snippet'], (code, field)
    objective = normalize(evidence['objective']['snippet'])
    strategy = normalize(evidence['strategy']['snippet'])
    benchmark = normalize(evidence['benchmark']['snippet'])
    assert re.search(r'목표로\s*운용|운용함을\s*목적|초과\s*(?:성과|수익률)', objective), (code, objective)
    assert re.search(r'투자\s*전략', strategy), (code, strategy)
    assert re.search(r'※\s*비교\s*지수\s*[:：]', benchmark), (code, benchmark)
    assert evidence['distribution']['found'] is False, (code, evidence['distribution'])
    return {
        'code': code,
        'agreement': quality['agreement'],
        'plumberUniqueTokens': quality['pdfplumber']['uniqueTokenCount'],
        'pypdfUniqueTokens': quality['pypdf']['uniqueTokenCount'],
    }

with ThreadPoolExecutor(max_workers=4) as executor:
    results = list(executor.map(inspect, sorted(codes)))
print(json.dumps(results, ensure_ascii=False))
`;
  const result = spawnSync(command, [...prefix, '-c', source, reportPath], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
    timeout: 60_000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
