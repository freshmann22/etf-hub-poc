// 원본(raw) 응답 파일 캐시 helpers. --force 없이는 이미 있는 raw 파일을 재요청하지 않는다(증분 수집).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readCache(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

export function writeCache(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

export function cacheExists(path) {
  return existsSync(path);
}

export function readJsonCache(path) {
  const raw = readCache(path);
  return raw == null ? null : JSON.parse(raw);
}

export function writeJsonCache(path, obj) {
  writeCache(path, JSON.stringify(obj, null, 2));
}
