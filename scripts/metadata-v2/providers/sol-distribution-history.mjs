const DATE = /^\d{8}$/;

function isoDate(value) {
  if (!DATE.test(String(value || ''))) return null;
  const text = String(value); const year = Number(text.slice(0, 4)); const month = Number(text.slice(4, 6)); const day = Number(text.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

export function parseSolDistributionHistoryJson(text, { expectedProductId = null, retrievedAt = null } = {}) {
  let payload;
  try { payload = JSON.parse(String(text || '')); }
  catch (error) { return { status: 'invalid_json', fundName: null, events: [], rejectedRows: [{ reason: 'invalid_json', detail: error.message }], evidence: null }; }
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const rejectedRows = [];
  const events = [];
  const rows = [];
  const retrievalLimit = retrievedAt && !Number.isNaN(Date.parse(retrievedAt)) ? Date.parse(retrievedAt) : null;
  items.forEach((item, index) => {
    const recordDate = isoDate(item?.WORK_DT);
    const payDate = isoDate(item?.DIVIDEND_DT);
    const amount = typeof item?.DIVIDEND_PRI === 'number' && Number.isFinite(item.DIVIDEND_PRI) && item.DIVIDEND_PRI > 0 ? item.DIVIDEND_PRI : null;
    const identityMatches = expectedProductId ? String(item?.FUND_CD || '') === String(expectedProductId) : true;
    const reason = !identityMatches ? 'fund_code_mismatch' : !recordDate ? 'record_date_missing_or_invalid' : !payDate ? 'pay_date_missing_or_invalid' : amount == null ? 'amount_missing_or_invalid' : Date.parse(payDate) < Date.parse(recordDate) ? 'pay_date_before_record_date' : retrievalLimit != null && Date.parse(payDate) > retrievalLimit ? 'future_payment_not_actual' : null;
    if (reason) { rejectedRows.push({ rowIndex: index + 1, reason, item }); return; }
    events.push({ exDate: null, recordDate, payDate, amount, currency: 'KRW', perUnit: null });
    rows.push(`WORK_DT=${item.WORK_DT}; DIVIDEND_DT=${item.DIVIDEND_DT}; DIVIDEND_PRI=${amount}; currency=KRW; perUnit=unknown`);
  });
  const unique = [...new Map(events.map((event) => [`${event.recordDate}|${event.payDate}|${event.amount}`, event])).values()].sort((a, b) => b.recordDate.localeCompare(a.recordDate) || b.payDate.localeCompare(a.payDate));
  return {
    status: rejectedRows.length ? unique.length ? 'partial' : 'no_valid_history_rows' : 'ok',
    fundName: typeof payload?.fundName === 'string' ? payload.fundName : null,
    declaredTotalCount: Number.isInteger(payload?.totalCount) ? payload.totalCount : null,
    events: unique, rejectedRows,
    evidence: { endpointFields: { recordDate: 'WORK_DT', payDate: 'DIVIDEND_DT', amount: 'DIVIDEND_PRI' }, currencyBasis: 'official popup JS header: 분배금액(원)', perUnitBasis: 'not_explicit_in_official_popup_header_or_json', rows },
  };
}

export function validateSolDividendJsContract(text) {
  const source = String(text || '');
  return {
    endpointTemplate: source.includes('/api/etf/pds/dividend/') ? '/api/etf/pds/dividend/{fundCode}' : null,
    recordDateField: source.includes('item.WORK_DT') && source.includes('지급기준일') ? 'WORK_DT' : null,
    payDateField: source.includes('item.DIVIDEND_DT') && source.includes('실제지급일') ? 'DIVIDEND_DT' : null,
    amountField: source.includes('item.DIVIDEND_PRI') && source.includes('분배금액(원)') ? 'DIVIDEND_PRI' : null,
    currency: source.includes('분배금액(원)') ? 'KRW' : null,
    perUnit: /주당\s*분배금액/u.test(source) ? 1 : null,
  };
}
