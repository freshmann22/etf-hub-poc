function clean(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

export function normalizeShortCode(value) {
  const code = clean(value)?.toUpperCase() ?? null;
  if (!code) return null;
  if (/^\d{1,6}$/.test(code)) return code.padStart(6, '0');
  return /^[0-9A-Z]{6}$/.test(code) ? code : null;
}

export function normalizeIsin(value) {
  const isin = clean(value)?.toUpperCase() ?? null;
  return isin && /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin) ? isin : null;
}

export function normalizeName(value) {
  return clean(value)?.normalize('NFKC').replace(/[\s·ㆍ･・_.()\[\]{}-]+/g, '').toUpperCase() ?? null;
}

function indexOfficialRows(rows) {
  const byCode = new Map();
  const byIsin = new Map();
  const byNameIssuer = new Map();
  for (const row of rows) {
    const shortCode = normalizeShortCode(row.shortCode ?? row.code ?? row.srtnCd);
    const isin = normalizeIsin(row.isin ?? row.isinCd);
    const name = normalizeName(row.officialName ?? row.name ?? row.itmsNm);
    const issuer = normalizeName(row.issuerName ?? row.issuer);
    const normalized = { ...row, shortCode, isin };
    if (shortCode) addToIndex(byCode, shortCode, normalized);
    if (isin) addToIndex(byIsin, isin, normalized);
    if (name && issuer) addToIndex(byNameIssuer, `${name}|${issuer}`, normalized);
  }
  return { byCode, byIsin, byNameIssuer };
}

function addToIndex(index, key, value) {
  const values = index.get(key) || [];
  values.push(value);
  index.set(key, values);
}

function uniqueHit(values) {
  return values?.length === 1 ? values[0] : null;
}

export function resolveIdentities(universe, officialRows) {
  const indexes = indexOfficialRows(officialRows);
  const records = [];
  const quarantined = [];

  for (const item of universe) {
    const universeKey = clean(item.universeKey ?? item.etfCode ?? item.code);
    const shortCode = normalizeShortCode(item.shortCode ?? item.etfCode ?? item.code);
    const isin = normalizeIsin(item.isin);
    const name = normalizeName(item.officialName ?? item.name);
    const issuer = normalizeName(item.issuerName ?? item.issuer);
    const candidates = new Map();

    for (const hit of indexes.byCode.get(shortCode) || []) candidates.set(identityKey(hit), { hit, method: 'short_code_exact' });
    for (const hit of indexes.byIsin.get(isin) || []) candidates.set(identityKey(hit), { hit, method: 'isin_exact' });

    let match = null;
    if (candidates.size === 1) match = [...candidates.values()][0];
    if (candidates.size > 1) {
      quarantined.push({ universeKey, shortCode, isin, name: item.name ?? null, reason: 'conflicting_exact_identifiers', candidateCount: candidates.size });
      continue;
    }

    if (!match && name && issuer) {
      const hit = uniqueHit(indexes.byNameIssuer.get(`${name}|${issuer}`));
      if (hit) match = { hit, method: 'name_issuer_exact' };
      else if ((indexes.byNameIssuer.get(`${name}|${issuer}`) || []).length > 1) {
        quarantined.push({ universeKey, shortCode, isin, name: item.name ?? null, reason: 'ambiguous_name_issuer', candidateCount: indexes.byNameIssuer.get(`${name}|${issuer}`).length });
        continue;
      }
    }

    if (!match) {
      quarantined.push({ universeKey, shortCode, isin, name: item.name ?? null, reason: 'unmatched', candidateCount: 0 });
      continue;
    }

    records.push({
      universeKey,
      shortCode: match.hit.shortCode,
      isin: match.hit.isin,
      officialName: match.hit.officialName ?? match.hit.name ?? match.hit.itmsNm ?? null,
      issuerId: match.hit.issuerId ?? null,
      issuerName: match.hit.issuerName ?? match.hit.issuer ?? null,
      listingDate: match.hit.listingDate ?? null,
      matchMethod: match.method,
    });
  }

  return { records, quarantined };
}

function identityKey(row) {
  return `${row.shortCode || ''}|${row.isin || ''}`;
}
