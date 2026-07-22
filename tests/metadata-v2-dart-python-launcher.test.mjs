import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pythonCandidates,
  selectPythonRuntime,
} from '../scripts/metadata-v2/run-dart-pdf-extraction.mjs';

function probeResult(details, status = 0) {
  return {
    status,
    stdout: JSON.stringify(details),
    stderr: '',
    error: null,
  };
}

test('explicit METADATA_V2_PYTHON is the only runtime candidate', () => {
  assert.deepEqual(
    pythonCandidates({ env: { METADATA_V2_PYTHON: '/opt/project-python' }, platform: 'linux' }),
    [{ command: '/opt/project-python', prefixArgs: [], explicit: true }],
  );
});

test('Windows launcher prefers the Python launcher and then python', () => {
  assert.deepEqual(
    pythonCandidates({ env: {}, platform: 'win32' }),
    [
      { command: 'py', prefixArgs: ['-3'], explicit: false },
      { command: 'python', prefixArgs: [], explicit: false },
    ],
  );
});

test('runtime selection skips a missing candidate and accepts a complete runtime', () => {
  const calls = [];
  const runtime = selectPythonRuntime({
    env: {},
    platform: 'linux',
    spawn(command, args) {
      calls.push({ command, args });
      if (command === 'python3') return { error: Object.assign(new Error('not found'), { code: 'ENOENT' }) };
      return probeResult({ executable: '/usr/bin/python', version: '3.12.1', missing: [] });
    },
  });
  assert.equal(runtime.command, 'python');
  assert.equal(runtime.details.executable, '/usr/bin/python');
  assert.deepEqual(calls.map((call) => call.command), ['python3', 'python']);
});

test('explicit runtime failure gives dependency and override diagnostics', () => {
  assert.throws(
    () => selectPythonRuntime({
      env: { METADATA_V2_PYTHON: '/bad/python' },
      platform: 'linux',
      spawn: () => probeResult({ executable: '/bad/python', version: '3.11.0', missing: ['pypdf'] }, 2),
    }),
    /METADATA_V2_PYTHON points to an unusable runtime:[\s\S]*Required Python modules: pdfplumber, pypdf[\s\S]*missing pypdf/,
  );
});
