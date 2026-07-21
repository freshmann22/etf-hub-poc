const TYPE_RANK = Object.freeze({ primary: 3, secondary: 2, derived: 1 });

function time(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

function sourceRank(candidate, policy) {
  const ids = policy.sourceIds || [];
  const index = ids.indexOf(candidate.provenance.sourceId);
  if (index !== -1) return ids.length - index + 10;
  return TYPE_RANK[candidate.provenance.sourceType] || 0;
}

function equivalent(left, right, tolerance = 0) {
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) <= tolerance;
  if (typeof left === 'string' && typeof right === 'string') {
    return left.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
      === right.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resolveCandidates(field, candidates, resolutionConfig = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { selected: null, candidates: [], conflict: null };
  }
  const policy = resolutionConfig.fields?.[field] || resolutionConfig.default || {};
  const strategy = policy.strategy || 'authority_then_confidence';
  const ranked = [...candidates].sort((a, b) => compare(a, b, strategy, policy));
  const selected = ranked[0];
  const disagreeing = ranked.filter((candidate) => !equivalent(selected.value, candidate.value, policy.numericTolerance || 0));
  const conflict = disagreeing.length
    ? {
        field,
        severity: policy.hardConflict ? 'hard' : 'warning',
        candidateIds: ranked.map((candidate) => candidate.candidateId),
        selectedCandidateId: policy.hardConflict ? null : selected.candidateId,
        resolutionRule: policy.hardConflict ? null : strategy,
        reason: policy.hardConflict
          ? 'authoritative identity candidates disagree; quarantine required'
          : `${disagreeing.length + 1} non-equivalent candidates; selected by ${strategy}`,
      }
    : null;
  return { selected: policy.hardConflict && conflict ? null : selected, candidates: ranked, conflict };
}

function compare(a, b, strategy, policy) {
  if (strategy === 'recency_then_authority') {
    const recency = time(b.provenance.asOfDate) - time(a.provenance.asOfDate);
    if (recency) return recency;
  }
  const authority = sourceRank(b, policy) - sourceRank(a, policy);
  if (authority) return authority;
  if (strategy !== 'recency_then_authority') {
    const recency = time(b.provenance.asOfDate) - time(a.provenance.asOfDate);
    if (recency) return recency;
  }
  const confidence = b.provenance.confidence - a.provenance.confidence;
  if (confidence) return confidence;
  return a.candidateId.localeCompare(b.candidateId);
}
