#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTRACTOR = resolve(ROOT, 'scripts/metadata-v2/extract_dart_pdf_batch.py');
const REQUIRED_MODULES = Object.freeze(['pdfplumber', 'pypdf']);

export function pythonCandidates({ env = process.env, platform = process.platform } = {}) {
  const explicit = env.METADATA_V2_PYTHON?.trim();
  if (explicit) return [{ command: explicit, prefixArgs: [], explicit: true }];
  if (platform === 'win32') {
    return [
      { command: 'py', prefixArgs: ['-3'], explicit: false },
      { command: 'python', prefixArgs: [], explicit: false },
    ];
  }
  return [
    { command: 'python3', prefixArgs: [], explicit: false },
    { command: 'python', prefixArgs: [], explicit: false },
  ];
}

function probeSource() {
  return [
    'import importlib.util, json, sys',
    `required = ${JSON.stringify(REQUIRED_MODULES)}`,
    'missing = [name for name in required if importlib.util.find_spec(name) is None]',
    'print(json.dumps({"executable": sys.executable, "version": sys.version.split()[0], "missing": missing}))',
    'raise SystemExit(2 if missing else 0)',
  ].join('; ');
}

export function selectPythonRuntime({
  env = process.env,
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  const failures = [];
  for (const candidate of pythonCandidates({ env, platform })) {
    const result = spawn(candidate.command, [...candidate.prefixArgs, '-c', probeSource()], {
      cwd: ROOT,
      encoding: 'utf8',
      env,
      windowsHide: true,
    });
    if (result.error) {
      failures.push(`${candidate.command}: ${result.error.message}`);
      continue;
    }
    let details = null;
    try {
      details = JSON.parse((result.stdout || '').trim());
    } catch {
      failures.push(`${candidate.command}: runtime probe returned invalid output`);
      continue;
    }
    if (result.status === 0 && details.missing?.length === 0) return { ...candidate, details };
    const missing = details.missing?.join(', ') || REQUIRED_MODULES.join(', ');
    failures.push(`${details.executable || candidate.command}: missing ${missing}`);
  }
  const requested = env.METADATA_V2_PYTHON?.trim();
  const selectionHint = requested
    ? `METADATA_V2_PYTHON points to an unusable runtime: ${requested}`
    : 'No usable Python runtime was found on PATH.';
  throw new Error([
    selectionHint,
    `Required Python modules: ${REQUIRED_MODULES.join(', ')}.`,
    'Set METADATA_V2_PYTHON to the full path of a Python executable that has those modules installed.',
    ...failures.map((failure) => `- ${failure}`),
  ].join('\n'));
}

export function run(argv = process.argv.slice(2), options = {}) {
  const runtime = selectPythonRuntime(options);
  console.log(`[metadata-v2:extract-dart] python=${runtime.details.executable} version=${runtime.details.version}`);
  if (argv.length === 1 && argv[0] === '--check-runtime') return 0;
  const result = (options.spawn || spawnSync)(
    runtime.command,
    [...runtime.prefixArgs, EXTRACTOR, ...argv],
    {
      cwd: ROOT,
      env: options.env || process.env,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(`[metadata-v2:extract-dart] ${error.message}`);
    process.exitCode = 1;
  }
}
