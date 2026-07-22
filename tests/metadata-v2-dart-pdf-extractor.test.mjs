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
    const result = spawnSync(command, [...prefix, '-c', 'import sys'], { cwd: ROOT, windowsHide: true });
    return !result.error && result.status === 0;
  }) || null;
}

test('full-batch extractor rejects ledger/index reception, code, date, and URL lineage mismatches', (t) => {
  const runtime = pythonRuntime();
  if (!runtime) return t.skip('Python runtime unavailable');
  const [command, prefix] = runtime;
  const source = String.raw`
import importlib.util
from pathlib import Path

path = Path('scripts/metadata-v2/extract_dart_pdf_batch.py')
spec = importlib.util.spec_from_file_location('extract_dart_pdf_batch', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def rows():
    ledger = {'0000D0': {
        'universeKey': '0000D0',
        'shortCode': '0000D0',
        'receptionNo': '20260721000123',
        'attachment': {'rcpNo': '20260721000123', 'dcmNo': '12345678'},
        'raw': {
            'main': {'url': 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260721000123'},
            'pdf': {'url': 'https://dart.fss.or.kr/report/download.do?dcmNo=12345678&flNm=test.pdf'},
        },
    }}
    index = {'0000D0': {
        'universeKey': '0000D0',
        'shortCode': '0000D0',
        'match': {
            'receptionNo': '20260721000123',
            'receptionDate': '20260721',
            'viewerUrl': 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260721000123',
        },
    }}
    return ledger, index

ledger, index = rows()
module.validate_ledger_index_lineage(ledger, index)
root = Path.cwd().resolve()
assert module.repository_path(root, root / 'alternate' / 'ledger.jsonl', 'source ledger') == 'alternate/ledger.jsonl'
assert module.extracted_value({'found': True, 'snippet': 'evidence', 'selectedPage': 9}, 'heading')['sourceEntries'] == ['pdf:p9']
assert module.confined_report_output(root, root / 'data/reports/metadata-v2/extraction.json').name == 'extraction.json'
for unsafe_output in (
    root / 'data/raw/metadata-v2/dart-pdf-batch/ledger.jsonl',
    root / 'reports/arbitrary.json',
    root / 'data/reports/metadata-v2/not-json.txt',
):
    try:
        module.confined_report_output(root, unsafe_output)
    except RuntimeError:
        pass
    else:
        raise AssertionError(f'unsafe output was accepted: {unsafe_output}')
try:
    module.repository_path(root, root.parent / 'outside-ledger.jsonl', 'source ledger')
except RuntimeError:
    pass
else:
    raise AssertionError('outside repository input path was accepted')
for mutation in ('code', 'reception', 'date', 'url', 'pdf_url'):
    ledger, index = rows()
    if mutation == 'code': index['0000D0']['shortCode'] = '0000H0'
    if mutation == 'reception': index['0000D0']['match']['receptionNo'] = '20260721000456'
    if mutation == 'date': index['0000D0']['match']['receptionDate'] = '20260720'
    if mutation == 'url': index['0000D0']['match']['viewerUrl'] += '&changed=1'
    if mutation == 'pdf_url': ledger['0000D0']['raw']['pdf']['url'] = 'https://dart.fss.or.kr/report/download.do?dcmNo=99999999'
    try:
        module.validate_ledger_index_lineage(ledger, index)
    except RuntimeError:
        continue
    raise AssertionError(f'{mutation} mismatch was accepted')
`;
  const result = spawnSync(command, [...prefix, '-c', source], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
