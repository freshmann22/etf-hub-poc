const DATE_PATTERN = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/;

function decode(value) {
  return String(value || '')
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(
      code.toLowerCase().startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10)
    ))
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;|&apos;/gi, "'");
}

function clean(value) {
  return decode(String(value || '')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<script\b[^]*?<\/script>/gi, ' ')
    .replace(/<style\b[^]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function normalizedHeader(value) {
  return clean(value).normalize('NFKC').replace(/\s+/g, '');
}

function isoDate(value) {
  const match = clean(value).match(DATE_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function numericAmount(value) {
  const text = clean(value);
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text.replaceAll(',', ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function cells(row, tag = 'td') {
  return [...String(row || '').matchAll(new RegExp(`<${tag}\\b[^>]*>([^]*?)<\\/${tag}>`, 'gi'))]
    .map((match) => clean(match[1]));
}

function tableSelector(table, caption) {
  const className = table.match(/^<table\b[^>]*class=["']([^"']+)["']/i)?.[1]?.trim();
  if (className) return `table.${className.split(/\s+/).join('.')}`;
  return caption ? `table:has(caption="${caption.slice(0, 120)}")` : 'table';
}

export function parseDistributionHistoryHtml(html, { retrievedAt = null } = {}) {
  const source = String(html || '');
  const rejectedRows = [];
  let matchingTable = null;
  for (const match of source.matchAll(/<table\b[^>]*>[^]*?<\/table>/gi)) {
    const table = match[0];
    const headers = cells(table.match(/<thead\b[^>]*>([^]*?)<\/thead>/i)?.[1] || table, 'th');
    const normalized = headers.map(normalizedHeader);
    const recordDateIndex = normalized.findIndex((value) => value === '지급기준일');
    const payDateIndex = normalized.findIndex((value) => value === '실지급일');
    const amountIndex = normalized.findIndex((value) => /^((주당)?분배금(액)?)\(원\)$/.test(value) && !value.includes('과세'));
    if (recordDateIndex >= 0 && payDateIndex >= 0 && amountIndex >= 0) {
      matchingTable = { table, headers, normalized, recordDateIndex, payDateIndex, amountIndex };
      break;
    }
  }

  if (!matchingTable) {
    const popupOnly = /분배금\s*현황/u.test(clean(source)) && /javascript:[^"']+/i.test(source);
    return {
      status: 'history_table_not_found', events: [], rejectedRows,
      diagnostic: popupOnly ? 'external_popup_not_in_raw_html' : 'policy_only_or_no_history_table',
      evidence: null,
    };
  }

  const { table, headers, normalized, recordDateIndex, payDateIndex, amountIndex } = matchingTable;
  const caption = clean(table.match(/<caption\b[^>]*>([^]*?)<\/caption>/i)?.[1] || '');
  const explicitPerShare = normalized[amountIndex].includes('주당') || normalizedHeader(caption).includes('주당분배금');
  const retrievedLimit = retrievedAt && !Number.isNaN(Date.parse(retrievedAt)) ? Date.parse(retrievedAt) : null;
  const rowsHtml = table.match(/<tbody\b[^>]*>([^]*?)<\/tbody>/i)?.[1] || table;
  const events = [];
  const rowEvidence = [];
  for (const [rowIndex, match] of [...rowsHtml.matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/gi)].entries()) {
    const values = cells(match[1]);
    if (!values.length) continue;
    const recordDate = isoDate(values[recordDateIndex]);
    const payDate = isoDate(values[payDateIndex]);
    const amount = numericAmount(values[amountIndex]);
    const reason = !recordDate ? 'record_date_missing_or_invalid'
      : !payDate ? 'pay_date_missing_or_invalid'
        : amount == null ? 'amount_missing_or_invalid'
          : Date.parse(payDate) < Date.parse(recordDate) ? 'pay_date_before_record_date'
            : retrievedLimit != null && Date.parse(payDate) > retrievedLimit ? 'future_payment_not_actual' : null;
    if (reason) {
      rejectedRows.push({ rowIndex: rowIndex + 1, reason, values });
      continue;
    }
    events.push({ exDate: null, recordDate, payDate, amount, currency: 'KRW', perUnit: explicitPerShare ? 1 : null });
    rowEvidence.push(`recordDate=${recordDate}; payDate=${payDate}; amount=${amount} KRW${explicitPerShare ? ' per 1 share' : '; per-share basis not explicit'}`);
  }
  const uniqueEvents = [...new Map(events.map((event) => [`${event.recordDate}|${event.payDate}|${event.amount}`, event])).values()]
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate) || b.payDate.localeCompare(a.payDate));
  return {
    status: uniqueEvents.length ? 'ok' : 'no_valid_history_rows',
    events: uniqueEvents,
    rejectedRows,
    diagnostic: uniqueEvents.length ? null : 'matching_table_has_no_explicit_actual_date_and_amount_rows',
    evidence: {
      sectionHeading: caption || '분배금 지급현황',
      selector: tableSelector(table, caption),
      headers,
      currencyBasis: headers[amountIndex],
      perUnitBasis: explicitPerShare ? 'explicit_table_caption_or_header' : 'not_explicit_in_raw_table',
      rows: rowEvidence,
    },
  };
}
