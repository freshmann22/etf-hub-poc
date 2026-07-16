const TAG_MODES = new Set(['required', 'preferred', 'excluded']);
const SORT_FIELDS = new Set(['volume', 'tradingValue', 'return1m', 'volatilityScore', 'totalFee']);

export function createTaxonomyIndex(taxonomy) {
  return new Map(
    (taxonomy?.tags || [])
      .filter((tag) => tag?.enabled !== false && tag?.id)
      .map((tag) => [tag.id, { tagId: tag.id, facet: tag.facet, label: tag.label }])
  );
}

export function buildRuleQueryPlan(parsed) {
  const tags = [];
  for (const group of parsed?.tagGroups || []) {
    const queryScore = group.tagIds.length === 1 ? 1 : 0.7;
    for (const tagId of group.tagIds) {
      tags.push({
        tagId,
        queryScore,
        mode: 'required',
        reason: `${group.matchedKeyword} 키워드 매칭`,
      });
    }
  }

  return {
    version: '1.0',
    intent: parsed?.intent || 'UNKNOWN',
    tags,
    sort: parsed?.sortField
      ? { field: parsed.sortField, direction: parsed.sortDir || 'desc', label: parsed.sortLabel || parsed.sortField }
      : null,
  };
}

export function validateQueryPlan(candidate, taxonomyIndex) {
  const warnings = [];
  const deduped = new Map();

  for (const raw of Array.isArray(candidate?.tags) ? candidate.tags.slice(0, 12) : []) {
    const canonical = taxonomyIndex.get(raw?.tagId);
    if (!canonical) {
      warnings.push(`unknown_tag:${String(raw?.tagId || '')}`);
      continue;
    }
    const score = Number(raw.queryScore);
    if (!Number.isFinite(score)) {
      warnings.push(`invalid_score:${canonical.tagId}`);
      continue;
    }
    const mode = TAG_MODES.has(raw.mode) ? raw.mode : 'preferred';
    const normalized = {
      ...canonical,
      queryScore: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
      mode,
      reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 120) : '',
    };
    const previous = deduped.get(normalized.tagId);
    if (!previous || normalized.queryScore > previous.queryScore) deduped.set(normalized.tagId, normalized);
  }

  let sort = null;
  if (candidate?.sort?.field && SORT_FIELDS.has(candidate.sort.field)) {
    sort = {
      field: candidate.sort.field,
      direction: candidate.sort.direction === 'asc' ? 'asc' : 'desc',
      label: typeof candidate.sort.label === 'string' ? candidate.sort.label.slice(0, 30) : candidate.sort.field,
    };
  } else if (candidate?.sort?.field) {
    warnings.push(`invalid_sort:${candidate.sort.field}`);
  }

  return {
    plan: {
      version: '1.0',
      intent: typeof candidate?.intent === 'string' ? candidate.intent : 'UNKNOWN',
      tags: [...deduped.values()].sort((a, b) => b.queryScore - a.queryScore || a.tagId.localeCompare(b.tagId)),
      sort,
    },
    warnings,
  };
}
