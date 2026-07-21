export function summarizeOfficialProductHtml(html, expectedName) {
  const text = toText(html);
  const normalized = normalize(text);
  return {
    expectedProductVisible: normalized.includes(normalize(expectedName)),
    fieldSignals: {
      productDescriptionOrObjective: /KEY POINT|투자포인트|운용목적|운용목표/u.test(text),
      benchmark: /기초\s*지수/u.test(text),
      distributionPolicy: /분배금(?:\s*지급)?(?:\s*기준일|\s*지급)/u.test(text),
      prospectusLinkLabel: /투자설명서/u.test(text),
    },
  };
}

export function parseDartViewerContract(html) {
  const nodes = [];
  const pattern = /node1\['text'\]\s*=\s*"([^"]+)";[\s\S]*?node1\['eleId'\]\s*=\s*"([^"]+)";[\s\S]*?node1\['offset'\]\s*=\s*"([^"]+)";[\s\S]*?node1\['length'\]\s*=\s*"([^"]+)";/g;
  for (const match of String(html || '').matchAll(pattern)) {
    nodes.push({ text: match[1], eleId: match[2], offset: Number(match[3]), length: Number(match[4]) });
  }
  const body = nodes.find((node) => /본\s*문/u.test(node.text));
  const attachmentLinks = [...String(html || '').matchAll(/(?:href|src)=["']([^"']+)["']/gi)]
    .map((match) => match[1]).filter((url) => /(?:attach|download|\.pdf(?:$|\?))/i.test(url));
  return {
    tocNodes: nodes,
    bodyNode: body || null,
    substantiveBodyAdvertised: Boolean(body && body.length >= 1000),
    publicAttachmentLinkCount: [...new Set(attachmentLinks)].length,
  };
}

function toText(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return String(value || '').normalize('NFKC').replace(/[^0-9a-zA-Z가-힣]+/g, '').toLowerCase();
}
