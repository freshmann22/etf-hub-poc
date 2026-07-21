import { mkdirSync, openSync, closeSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { sha256 } from './provenance.js';

function safeSegment(value, label) {
  const segment = String(value || '').trim();
  if (!segment || !/^[0-9A-Za-z._-]+$/.test(segment) || segment === '.' || segment === '..') {
    throw new Error(`invalid ${label}`);
  }
  return segment;
}

function assertInside(root, target) {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(`..${sep}`)) {
    throw new Error('raw snapshot path escapes root');
  }
}

export class AppendOnlyRawStore {
  constructor(rootDir, { now = () => new Date() } = {}) {
    this.rootDir = resolve(rootDir);
    this.now = now;
    mkdirSync(this.rootDir, { recursive: true });
  }

  put({ sourceId, key, content, extension = 'bin', metadata = {} }) {
    const source = safeSegment(sourceId, 'sourceId');
    const itemKey = safeSegment(key, 'key');
    const ext = safeSegment(extension.replace(/^\./, ''), 'extension');
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    const contentHash = sha256(bytes);
    const retrievedAt = metadata.retrievedAt || this.now().toISOString();
    const day = retrievedAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('retrievedAt must start with YYYY-MM-DD');

    const directory = resolve(this.rootDir, source, day);
    const path = resolve(directory, `${itemKey}.${contentHash}.${ext}`);
    assertInside(this.rootDir, path);
    mkdirSync(directory, { recursive: true });
    if (!existsSync(path)) {
      let fd;
      try {
        fd = openSync(path, 'wx');
        writeFileSync(fd, bytes);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      } finally {
        if (fd != null) closeSync(fd);
      }
    } else if (sha256(readFileSync(path)) !== contentHash) {
      throw new Error('append-only snapshot hash mismatch');
    }

    const entry = {
      sourceId: source,
      key: itemKey,
      path: relative(this.rootDir, path).replaceAll('\\', '/'),
      contentHash,
      byteLength: bytes.length,
      retrievedAt,
      status: metadata.status || 'ok',
      url: metadata.url ?? null,
      parserVersion: metadata.parserVersion ?? null,
    };
    appendFileSync(resolve(this.rootDir, 'manifest.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }
}
