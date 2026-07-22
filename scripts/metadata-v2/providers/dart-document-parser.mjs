const SECTION_HEADING = {
  cover: '투자설명서 표지',
};

export function parseDartDocument(entries) {
  const documents = [...entries.entries()]
    .filter(([name]) => name.toLowerCase().endsWith('.xml'))
    .map(([name, bytes]) => ({ name, xml: Buffer.from(bytes).toString('utf8') }));
  if (!documents.length) return emptyResult('no_xml_entry');
  const xml = documents.map((item) => item.xml).join('\n');
  const coverXml = xml.match(/<COVER\b[^>]*>([\s\S]*?)<\/COVER>/i)?.[1] || '';
  const coverText = cleanText(coverXml);
  const sections = extractSections(xml);
  const bodySections = sections.filter((section) => !/^\[?\s*본\s*문\s*\]?$/u.test(section.heading));

  const officialName = evidenceFromAcode(xml, 'FUND_NAME', SECTION_HEADING.cover);
  const issuer = evidenceFromAcode(xml, 'FUND_TRD', SECTION_HEADING.cover)
    || evidenceFromTag(xml, 'COMPANY-NAME', SECTION_HEADING.cover);
  const investmentObjective = evidenceFromSection(bodySections, /투자\s*목적|운용\s*목적/u);
  const productDescription = evidenceFromSection(bodySections, /집합투자기구의\s*(?:개요|특징)|상품\s*(?:개요|설명)/u);
  const benchmarkDescription = evidenceFromSectionKeyword(bodySections, /기초\s*지수|비교\s*지수/u);
  const benchmarkName = benchmarkDescription ? extractQuotedBenchmark(benchmarkDescription) : null;
  const distributionPolicy = evidenceFromSection(bodySections, /분배금|이익\s*분배/u);
  const nameEvidence = officialName?.value || coverText;

  const flags = {
    derivative: keywordFlag(nameEvidence, /파생형/u, officialName),
    leveraged: keywordFlag(nameEvidence, /레버리지/u, officialName),
    inverse: keywordFlag(nameEvidence, /인버스/u, officialName),
    synthetic: keywordFlag(nameEvidence, /(?:^|[^가-힣])합성(?:[^가-힣]|$)/u, officialName),
    currencyHedged: keywordFlag(nameEvidence, /(?:\(\s*H\s*\)|환헤지|환율변동위험\s*회피)/iu, officialName),
  };

  return {
    parserStatus: 'parsed',
    sourceEntries: documents.map((item) => item.name),
    diagnostics: {
      xmlEntryCount: documents.length,
      coverTextLength: coverText.length,
      sectionCount: sections.length,
      substantiveBodySectionCount: bodySections.filter((section) => section.text.length >= 20).length,
      substantiveBodyTextLength: bodySections.reduce((sum, section) => sum + section.text.length, 0),
      coverOnly: bodySections.reduce((sum, section) => sum + section.text.length, 0) < 20,
    },
    fields: {
      officialName,
      issuer,
      productDescription,
      investmentObjective,
      benchmarkName,
      benchmarkDescription,
      flags,
      distributionPolicy,
    },
  };
}

function emptyResult(reason) {
  return {
    parserStatus: reason,
    sourceEntries: [],
    diagnostics: { xmlEntryCount: 0, coverTextLength: 0, sectionCount: 0, substantiveBodySectionCount: 0, substantiveBodyTextLength: 0, coverOnly: true },
    fields: {
      officialName: null, issuer: null, productDescription: null, investmentObjective: null,
      benchmarkName: null, benchmarkDescription: null,
      flags: { derivative: null, leveraged: null, inverse: null, synthetic: null, currencyHedged: null },
      distributionPolicy: null,
    },
  };
}

function extractSections(xml) {
  const sections = [];
  for (const match of xml.matchAll(/<SECTION-\d+\b[^>]*>([\s\S]*?)<\/SECTION-\d+>/gi)) {
    const body = match[1];
    const heading = cleanText(body.match(/<TITLE\b[^>]*>([\s\S]*?)<\/TITLE>/i)?.[1] || '');
    const text = cleanText(body.replace(/<TITLE\b[^>]*>[\s\S]*?<\/TITLE>/i, ''));
    sections.push({ heading, text });
  }
  return sections;
}

function evidenceFromAcode(xml, acode, sectionHeading) {
  const escaped = acode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<(TE|TD)\\b[^>]*\\bACODE=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'));
  const value = cleanText(match?.[2] || '');
  return value ? evidence(value, sectionHeading, value) : null;
}

function evidenceFromTag(xml, tag, sectionHeading) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  const value = cleanText(match?.[1] || '');
  return value ? evidence(value, sectionHeading, value) : null;
}

function evidenceFromSection(sections, headingPattern) {
  const section = sections.find((item) => headingPattern.test(item.heading) && item.text.length >= 20);
  if (!section) return null;
  return evidence(section.text.slice(0, 1000), section.heading, section.text.slice(0, 320));
}

function evidenceFromSectionKeyword(sections, keywordPattern) {
  const section = sections.find((item) => item.text.length >= 20 && keywordPattern.test(item.text));
  if (!section) return null;
  const index = section.text.search(keywordPattern);
  return evidence(section.text.slice(0, 1000), section.heading, snippetAround(section.text, index));
}

function extractQuotedBenchmark(sourceEvidence) {
  const text = sourceEvidence.value;
  const match = text.match(/(?:기초|비교)\s*지수(?:인|는|로|명칭은|명칭이)?\s*[‘'“"「『]([^’'”"」』]{2,160})[’'”"」』]/u);
  return match ? evidence(match[1].trim(), sourceEvidence.sectionHeading, snippetAround(text, match.index || 0)) : null;
}

function keywordFlag(text, pattern, sourceEvidence) {
  if (!sourceEvidence || !pattern.test(text)) return null;
  const index = text.search(pattern);
  return evidence(true, sourceEvidence.sectionHeading, snippetAround(text, index));
}

function evidence(value, sectionHeading, snippet) {
  return { value, sectionHeading, snippet: String(snippet || '').slice(0, 320) };
}

function snippetAround(text, index) {
  return String(text || '').slice(Math.max(0, index - 100), index + 220).trim();
}

function cleanText(value) {
  return decodeXml(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeXml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
