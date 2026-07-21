export function normalizeDartText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\[(?:기재정정|첨부정정)\]/g, '')
    .replace(/주식회사|\(주\)|㈜/g, '')
    .replace(/[^0-9a-zA-Z가-힣]+/g, '')
    .toLowerCase();
}

export function isFullFundProspectus(reportName) {
  const name = String(reportName || '');
  return name.includes('투자설명서(집합투자증권)') && !name.includes('간이투자설명서');
}

export function matchLatestProspectus(canary, disclosures) {
  const target = normalizeDartText(canary.name);
  const candidates = disclosures
    .filter((row) => isFullFundProspectus(row.report_nm))
    .filter((row) => normalizeDartText(row.report_nm).includes(target))
    .sort((a, b) => String(b.rcept_dt).localeCompare(String(a.rcept_dt)) || String(b.rcept_no).localeCompare(String(a.rcept_no)));
  const match = candidates[0] || null;
  return {
    matched: Boolean(match),
    method: match ? 'normalized_full_name_containment' : 'none',
    candidateCount: candidates.length,
    match,
  };
}
