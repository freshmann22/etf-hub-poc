// 인메모리 캐시 — TTL + stale-while-revalidate + 인플라이트 요청 병합(dedup).
// 외부 데이터를 매 요청마다 호출하지 않기 위한 최소 구현. 무한 재시도 없음.

export class TtlCache {
  constructor({ now = () => Date.now() } = {}) {
    this._store = new Map(); // key -> { value, storedAt, ttlMs, swrMs }
    this._inflight = new Map(); // key -> Promise
    this._now = now;
  }

  _entryState(entry) {
    const age = this._now() - entry.storedAt;
    if (age <= entry.ttlMs) return 'fresh';
    if (age <= entry.ttlMs + entry.swrMs) return 'stale';
    return 'expired';
  }

  peek(key) {
    const entry = this._store.get(key);
    if (!entry) return { hit: false, state: 'miss', value: undefined };
    return { hit: true, state: this._entryState(entry), value: entry.value };
  }

  set(key, value, { ttlMs, swrMs = 0 }) {
    this._store.set(key, { value, storedAt: this._now(), ttlMs, swrMs });
  }

  delete(key) {
    this._store.delete(key);
  }

  clear() {
    this._store.clear();
    this._inflight.clear();
  }

  /**
   * fresh 면 캐시 반환. stale 면 캐시를 즉시 반환하고 백그라운드 갱신(SWR).
   * miss/expired 면 fetcher 대기. 동일 key 동시 요청은 하나로 병합.
   * 반환: { value, fromCache, state }
   */
  async resolve(key, fetcher, { ttlMs, swrMs = 0 } = {}) {
    const { hit, state, value } = this.peek(key);

    if (hit && state === 'fresh') {
      return { value, fromCache: true, state: 'fresh' };
    }

    if (hit && state === 'stale') {
      // 즉시 stale 반환 + 백그라운드 갱신(중복 방지).
      this._revalidate(key, fetcher, { ttlMs, swrMs });
      return { value, fromCache: true, state: 'stale' };
    }

    // miss 또는 expired: 신선 데이터 대기 (인플라이트 병합).
    const fresh = await this._revalidate(key, fetcher, { ttlMs, swrMs });
    return { value: fresh, fromCache: false, state: 'fresh' };
  }

  _revalidate(key, fetcher, opts) {
    if (this._inflight.has(key)) return this._inflight.get(key);
    const p = Promise.resolve()
      .then(() => fetcher())
      .then((value) => {
        this.set(key, value, opts);
        return value;
      })
      .finally(() => {
        this._inflight.delete(key);
      });
    this._inflight.set(key, p);
    return p;
  }
}
