import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const TERMINAL = new Set(['success', 'empty', 'terminal']);

export class ResumableLedger {
  constructor(path, { now = () => new Date() } = {}) {
    this.path = resolve(path);
    this.now = now;
    this.state = existsSync(this.path)
      ? JSON.parse(readFileSync(this.path, 'utf8'))
      : { version: 1, updatedAt: null, tasks: {} };
  }

  key(sourceId, itemKey) {
    return `${sourceId}:${itemKey}`;
  }

  get(sourceId, itemKey) {
    return this.state.tasks[this.key(sourceId, itemKey)] ?? null;
  }

  shouldRun(sourceId, itemKey, { parserVersion, staleBefore = null, force = false } = {}) {
    if (force) return true;
    const task = this.get(sourceId, itemKey);
    if (!task) return true;
    if (task.status === 'retryable') return !task.nextRetryAt || Date.parse(task.nextRetryAt) <= this.now().getTime();
    if (!TERMINAL.has(task.status)) return true;
    if (parserVersion && task.parserVersion !== parserVersion) return true;
    if (staleBefore && task.completedAt && Date.parse(task.completedAt) < Date.parse(staleBefore)) return true;
    return false;
  }

  claim(sourceId, itemKey, { parserVersion }) {
    const id = this.key(sourceId, itemKey);
    const prior = this.state.tasks[id] || {};
    this.state.tasks[id] = {
      ...prior,
      sourceId,
      itemKey,
      status: 'running',
      attempts: (prior.attempts || 0) + 1,
      parserVersion,
      startedAt: this.now().toISOString(),
      nextRetryAt: null,
    };
    this.save();
    return this.state.tasks[id];
  }

  complete(sourceId, itemKey, { status = 'success', rawHash = null, parserVersion = null } = {}) {
    if (!TERMINAL.has(status)) throw new Error(`invalid terminal status: ${status}`);
    return this.update(sourceId, itemKey, {
      status,
      rawHash,
      parserVersion: parserVersion || this.get(sourceId, itemKey)?.parserVersion || null,
      completedAt: this.now().toISOString(),
      lastError: null,
      nextRetryAt: null,
    });
  }

  fail(sourceId, itemKey, error, { retryable = true, retryAfterMs = 0 } = {}) {
    const now = this.now();
    return this.update(sourceId, itemKey, {
      status: retryable ? 'retryable' : 'terminal',
      lastError: String(error?.message || error),
      completedAt: retryable ? null : now.toISOString(),
      nextRetryAt: retryable ? new Date(now.getTime() + Math.max(0, retryAfterMs)).toISOString() : null,
    });
  }

  update(sourceId, itemKey, patch) {
    const id = this.key(sourceId, itemKey);
    this.state.tasks[id] = { ...(this.state.tasks[id] || { sourceId, itemKey, attempts: 0 }), ...patch };
    this.save();
    return this.state.tasks[id];
  }

  save() {
    const directory = dirname(this.path);
    mkdirSync(directory, { recursive: true });
    this.state.updatedAt = this.now().toISOString();
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.path);
  }
}
