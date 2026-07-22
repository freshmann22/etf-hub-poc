export function parseKoactDistributionHistoryJson(body, { retrievedAt = null } = {}) {
  let payload;
  try { payload = JSON.parse(String(body || '')); }
  catch (error) { return { status: 'invalid_json', events: [], rejectedRows: [{ jsonPath: '$', reason: 'invalid_json', detail: error.message }], evidence: null }; }
  const rows = payload?.info?.divideList;
  if (!Array.isArray(rows)) return { status: 'history_array_missing', events: [], rejectedRows: [], evidence: null };
  const retrievalDate = isoDate(retrievedAt);
  const events = [];
  const rejectedRows = [];
  const evidenceRows = [];
  rows.forEach((row, index) => {
    const jsonPath = `$.info.divideList[${index}]`;
    const recordDate = compactDate(row?.BASIC_D);
    const payDate = compactDate(row?.PAY_D);
    const amount = positiveNumber(row?.DIVID_A);
    let reason = null;
    if (!recordDate) reason = 'record_date_missing_or_invalid';
    else if (!payDate) reason = 'pay_date_missing_or_invalid';
    else if (payDate < recordDate) reason = 'pay_date_before_record_date';
    else if (retrievalDate && payDate > retrievalDate) reason = 'future_payment_not_actual';
    else if (amount == null) reason = 'amount_missing_or_invalid';
    if (reason) { rejectedRows.push({ jsonPath, reason }); return; }
    events.push({ exDate: null, recordDate, payDate, amount, currency: null, perUnit: null });
    evidenceRows.push(`${jsonPath}={BASIC_D:${row.BASIC_D},PAY_D:${row.PAY_D},DIVID_A:${row.DIVID_A}}`);
  });
  return { status: events.length ? 'ok' : 'no_valid_history_rows', events, rejectedRows, evidence: events.length ? { selector: '$.info.divideList[*]', rows: evidenceRows, currencyBasis: 'not_explicit_in_raw_json', perUnitBasis: 'not_explicit_in_raw_json' } : null };
}

function compactDate(value) { const text = String(value ?? ''); if (!/^\d{8}$/.test(text)) return null; const date = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`; const parsed = new Date(`${date}T00:00:00Z`); return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ? null : date; }
function isoDate(value) { const parsed = Date.parse(value); return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10); }
function positiveNumber(value) { const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replaceAll(',', '').trim()); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
