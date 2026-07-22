import { inflateRawSync } from 'node:zlib';

const API_ROOT = 'https://opendart.fss.or.kr/api';

export class DartClient {
  constructor({ apiKey, maxCalls = 48, fetchImpl = globalThis.fetch, timeoutMs = 30000, minIntervalMs = 0 } = {}) {
    if (!apiKey) throw new Error('DART_API_KEY is required');
    this.apiKey = apiKey;
    this.maxCalls = maxCalls;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.callCount = 0;
    this.minIntervalMs = minIntervalMs;
    this.nextAllowedAt = 0;
  }

  async _fetch(endpoint, params = {}) {
    if (this.callCount >= this.maxCalls) throw new Error(`DART call budget exceeded (${this.maxCalls})`);
    this.callCount += 1;
    const delay = Math.max(0, this.nextAllowedAt - Date.now());
    if (delay) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    this.nextAllowedAt = Date.now() + this.minIntervalMs;
    const url = new URL(`${API_ROOT}/${endpoint}`);
    url.searchParams.set('crtfc_key', this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { accept: '*/*' } });
      if (!response.ok) throw new Error(`DART HTTP ${response.status} at ${endpoint}`);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  async getCorpCodes() {
    const response = await this._fetch('corpCode.xml');
    const bytes = Buffer.from(await response.arrayBuffer());
    const files = unzipEntries(bytes);
    const xml = [...files.entries()].find(([name]) => name.toLowerCase().endsWith('.xml'))?.[1];
    if (!xml) throw new Error('DART corpCode archive did not contain XML');
    return parseCorpCodeXml(xml.toString('utf8'));
  }

  async listFundDisclosures({ corpCode, beginDate, endDate, maxPages = 2 }) {
    const rows = [];
    let totalPages = 1;
    let totalCount = 0;
    for (let page = 1; page <= Math.min(totalPages, maxPages); page += 1) {
      const response = await this._fetch('list.json', {
        corp_code: corpCode,
        bgn_de: beginDate,
        end_de: endDate,
        last_reprt_at: 'Y',
        pblntf_ty: 'G',
        sort: 'date',
        sort_mth: 'desc',
        page_no: page,
        page_count: 100,
      });
      const body = await response.json();
      if (body.status === '013') return { rows: [], totalCount: 0, totalPages: 0, pagesFetched: page };
      if (body.status !== '000') throw new Error(`DART list API status ${body.status || 'unknown'}`);
      rows.push(...(Array.isArray(body.list) ? body.list : []));
      totalPages = Number(body.total_page) || 1;
      totalCount = Number(body.total_count) || rows.length;
    }
    return {
      rows,
      totalCount,
      totalPages,
      pagesFetched: Math.min(totalPages, maxPages),
      truncated: totalPages > maxPages,
    };
  }

  async probeDocument(receptNo) {
    const archive = await this.downloadDocument(receptNo);
    return {
      accessible: archive.entries.size > 0,
      archiveBytes: archive.bytes.length,
      entryCount: archive.entries.size,
      entryExtensions: [...new Set([...archive.entries.keys()].map((name) => name.includes('.') ? name.split('.').pop().toLowerCase() : 'none'))].sort(),
    };
  }

  async downloadDocument(receptNo) {
    if (!/^\d{14}$/.test(String(receptNo || ''))) throw new Error('invalid DART reception number');
    const response = await this._fetch('document.xml', { rcept_no: receptNo });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
      const status = bytes.toString('utf8', 0, Math.min(bytes.length, 4096)).match(/<status>(\d+)<\/status>/)?.[1] || null;
      const error = new Error(`DART document API returned ${status ? `status ${status}` : 'a non-ZIP response'}`);
      error.dartStatus = status;
      throw error;
    }
    const entries = unzipEntries(bytes);
    return { bytes, entries };
  }
}

export function parseCorpCodeXml(xml) {
  const rows = [];
  for (const match of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const block = match[1];
    const value = (tag) => decodeXml(block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] || '').trim();
    const corpCode = value('corp_code');
    if (corpCode) rows.push({
      corpCode,
      corpName: value('corp_name'),
      stockCode: value('stock_code') || null,
      modifyDate: value('modify_date') || null,
    });
  }
  return rows;
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function unzipEntries(buffer) {
  const bytes = Buffer.from(buffer);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('DART response is not a ZIP archive');
  const count = bytes.readUInt16LE(eocd + 10);
  let centralOffset = bytes.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error('invalid ZIP central directory');
    const method = bytes.readUInt16LE(centralOffset + 10);
    const compressedSize = bytes.readUInt32LE(centralOffset + 20);
    const nameLength = bytes.readUInt16LE(centralOffset + 28);
    const extraLength = bytes.readUInt16LE(centralOffset + 30);
    const commentLength = bytes.readUInt16LE(centralOffset + 32);
    const localOffset = bytes.readUInt32LE(centralOffset + 42);
    const name = bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8');
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('invalid ZIP local header');
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!content) throw new Error(`unsupported ZIP compression method ${method}`);
    files.set(name, content);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
