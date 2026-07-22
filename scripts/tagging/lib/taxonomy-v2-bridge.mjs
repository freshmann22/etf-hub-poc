function hasValue(value) {
  return value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);
}

function legacyHoldings(rows = []) {
  return rows.map((row, index) => ({
    rank: index + 1,
    code: row.shortCode ?? row.ticker ?? null,
    name: row.name,
    weight: row.weight,
  }));
}

function fieldSources(record) {
  const sources = [];
  for (const [field, candidates] of Object.entries(record.fieldCandidates || {})) {
    for (const candidate of candidates || []) {
      if (!candidate?.provenance?.sourceId) continue;
      sources.push({
        field,
        sourceId: candidate.provenance.sourceId,
        sourceType: candidate.provenance.sourceType ?? null,
        url: candidate.provenance.url ?? null,
        retrievedAt: candidate.provenance.retrievedAt ?? null,
      });
    }
  }
  return sources;
}

function trailing12MonthAmount(history, generatedAt) {
  const anchor = new Date(generatedAt);
  if (Number.isNaN(anchor.getTime())) return null;
  const cutoff = new Date(anchor);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const amounts = history.flatMap((item) => {
    const eventDate = item.payDate || item.recordDate || item.exDate;
    const timestamp = Date.parse(eventDate || '');
    const amount = item.amount == null ? Number.NaN : Number(item.amount);
    return Number.isFinite(timestamp) && timestamp >= cutoff.getTime() && timestamp <= anchor.getTime() && Number.isFinite(amount)
      ? [amount]
      : [];
  });
  return amounts.length ? amounts.reduce((sum, amount) => sum + amount, 0) : null;
}

export function adaptCanonicalV2ForTaxonomy(canonical) {
  if (canonical?.schemaVersion !== '2.0.0' || !Array.isArray(canonical.records)) {
    throw new Error('taxonomy v2 bridge requires metadata schemaVersion 2.0.0 records');
  }
  if (canonical.records.length !== canonical.universeCount) throw new Error('taxonomy v2 bridge canonical shape mismatch');
  const codes = canonical.records.map((record) => record.identity?.shortCode);
  if (codes.some((code) => !/^[0-9A-Z]{6}$/.test(code || '')) || new Set(codes).size !== codes.length) {
    throw new Error('taxonomy v2 bridge requires unique six-character short codes');
  }

  const records = canonical.records.map((record) => {
    const history = record.distribution?.history || [];
    const holdings = legacyHoldings(record.portfolio?.holdings || []);
    return {
      etfCode: record.identity.shortCode,
      codeType: /^\d{6}$/.test(record.identity.shortCode) ? 'krx_numeric' : 'naver_internal_unresolved',
      name: record.identity.officialName,
      issuer: record.identity.issuerName,
      listingDate: record.identity.listingDate,
      benchmark: {
        name: record.product?.benchmark?.name ?? null,
        provider: record.product?.benchmark?.provider ?? null,
        description: record.product?.benchmark?.description ?? null,
      },
      classificationFacts: {
        assetClass: record.product?.assetClasses || [],
        regions: record.product?.targetRegions || [],
        active: record.product?.active ?? null,
        currencyHedged: record.product?.currencyHedged ?? null,
        rawTypeText: null,
        nameHints: [],
      },
      holdings,
      holdingsAsOfDate: record.portfolio?.asOfDate ?? null,
      sectorWeights: record.portfolio?.sectorWeights || [],
      countryWeights: record.portfolio?.countryWeights || [],
      distribution: {
        applicability: record.distribution?.applicability ?? 'unknown',
        frequency: record.distribution?.frequency ?? null,
        scheduleText: record.distribution?.schedule ?? null,
        trailing12MonthAmount: trailing12MonthAmount(history, canonical.generatedAt),
        history,
      },
      descriptions: {
        productDescription: record.product?.description ?? null,
        investmentObjective: record.product?.investmentObjective ?? null,
        strategyDescription: null,
        benchmarkDescription: record.product?.benchmark?.description ?? null,
      },
      sources: fieldSources(record),
      conflicts: record.conflicts || [],
    };
  });

  return {
    metadata: { generatedAt: canonical.generatedAt, masterEtfCount: canonical.universeCount, integratedRecordCount: records.filter((row) => row.sources.length || hasValue(row.descriptions.productDescription) || hasValue(row.holdings)).length, records },
    holdings: {
      generatedAt: canonical.generatedAt,
      etfs: Object.fromEntries(records.map((row) => [row.etfCode, { name: row.name, source: 'metadata_v2_bridge', asOfDate: row.holdingsAsOfDate, holdings: row.holdings }])),
    },
  };
}

export function applyCoverageV2ToReadinessRows(rows, coverage) {
  if (!coverage?.shapePreserved || coverage.universeCount !== rows.length || !Array.isArray(coverage.rows)) {
    throw new Error('taxonomy v2 bridge requires shape-preserved coverage matching readiness rows');
  }
  const byCode = new Map(coverage.rows.map((row) => [row.shortCode, row]));
  if (byCode.size !== rows.length) throw new Error('taxonomy v2 bridge coverage short codes are missing or duplicated');
  return rows.map((row) => {
    const v2 = byCode.get(row.etfCode);
    if (!v2 || !Number.isFinite(v2.score) || !['A', 'B', 'C', 'D'].includes(v2.grade)) {
      throw new Error(`taxonomy v2 bridge coverage row missing for ${row.etfCode}`);
    }
    return { ...row, score: v2.score, grade: v2.grade, v2Readiness: { score: v2.score, grade: v2.grade, provenanceSelected: v2.provenanceSelected, provenanceBacked: v2.provenanceBacked } };
  });
}

export function selectReadyCoreRows(readyRows, { target, tagsFor, tagPopulation, lowByCode }) {
  if (readyRows.length <= target) return [...readyRows];
  const remaining = new Map(readyRows.map((row) => [row.etfCode, row]));
  const selected = [];
  const covered = new Set();
  while (selected.length < target && remaining.size) {
    const ranked = [...remaining.values()].map((row) => {
      const tags = tagsFor(row.etfCode);
      const newTags = tags.filter((tag) => !covered.has(tag));
      const rarity = newTags.reduce((sum, tag) => sum + 1000 / Math.max(1, tagPopulation.get(tag) || 1), 0);
      return { row, newTags, rarity, lowCount: lowByCode.get(row.etfCode)?.length || 0, tagCount: tags.length };
    }).sort((a, b) => b.newTags.length - a.newTags.length || b.rarity - a.rarity || b.lowCount - a.lowCount
      || b.row.score - a.row.score || b.tagCount - a.tagCount || a.row.etfCode.localeCompare(b.row.etfCode));
    const winner = ranked[0];
    selected.push(winner.row);
    remaining.delete(winner.row.etfCode);
    for (const tag of tagsFor(winner.row.etfCode)) covered.add(tag);
  }
  return selected;
}
