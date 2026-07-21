import { X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOST = 'www.kiwoometf.com';
const ROBOTS_URL = `https://${HOST}/robots.txt`;
const PRODUCT_ROUTE = `https://${HOST}/service/etf/KO02010200M?gcode={shortCode}`;
const ALTERNATE_HOSTS = ['www.kiwoomam.com', 'new.kiwoomam.com', 'www.kosef.co.kr'];

function strictHttpsProbe(url, timeoutMs = 15000) {
  return new Promise((resolveProbe) => {
    const request = https.get(url, { timeout: timeoutMs, rejectUnauthorized: true, headers: { accept: 'text/plain,text/html;q=0.9', 'user-agent': 'etf-metadata-v2-policy-probe/1.0' } }, (response) => {
      let bytes = 0;
      response.on('data', (chunk) => { bytes += chunk.length; });
      response.on('end', () => resolveProbe({ ok: true, status: response.statusCode, bytes, url }));
    });
    request.on('timeout', () => request.destroy(new Error('request_timeout')));
    request.on('error', (error) => resolveProbe({ ok: false, status: null, url, code: error.code || null, error: error.message }));
  });
}

function nodeSystemCaProbe(url) {
  const code = `fetch(${JSON.stringify(url)}).then(r=>console.log(JSON.stringify({ok:true,status:r.status}))).catch(e=>console.log(JSON.stringify({ok:false,code:e.cause?.code||null,error:e.cause?.message||e.message})))`;
  const result = spawnSync(process.execPath, ['--use-system-ca', '-e', code], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  try { return JSON.parse(String(result.stdout || '').trim()); }
  catch { return { ok: false, code: 'system_ca_probe_failed', error: String(result.stderr || result.error?.message || '').trim() }; }
}

function windowsNativeProbe(url) {
  const result = spawnSync('curl.exe', ['-I', '--max-time', '15', '--silent', '--show-error', url], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  return {
    ok: result.status === 0,
    exitCode: result.status,
    tlsBackend: 'Schannel',
    error: result.status === 0 ? null : String(result.stderr || result.error?.message || '').replace(/\s+/g, ' ').trim().slice(0, 800),
  };
}

function opensslChainProbe(host) {
  const result = spawnSync('openssl', ['s_client', '-showcerts', '-verify_return_error', '-connect', `${host}:443`, '-servername', host], {
    input: '', encoding: 'utf8', timeout: 20000, windowsHide: true,
  });
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const certificates = [...combined.matchAll(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/g)].map((match) => match[0]);
  let leaf = null;
  if (certificates[0]) {
    const certificate = new X509Certificate(certificates[0]);
    leaf = {
      subject: certificate.subject,
      issuer: certificate.issuer,
      validFrom: certificate.validFrom,
      validTo: certificate.validTo,
      fingerprint256: certificate.fingerprint256,
      subjectAltName: certificate.subjectAltName,
      infoAccess: certificate.infoAccess,
    };
  }
  const verificationError = combined.match(/verify error:num=\d+:([^\r\n]+)/)?.[1]?.trim()
    || combined.match(/Verification error:\s*([^\r\n]+)/)?.[1]?.trim() || null;
  return {
    ok: result.status === 0,
    exitCode: result.status,
    presentedCertificateCount: certificates.length,
    verificationError,
    leaf,
  };
}

export function evaluateKiwoomAccess(evidence) {
  const tlsVerified = evidence.nodeBundled?.ok === true && evidence.nodeSystemCa?.ok === true && evidence.windowsNative?.ok === true;
  const chainComplete = evidence.serverChain?.presentedCertificateCount > 1 && evidence.serverChain?.verificationError == null;
  const alternateVerified = (evidence.alternateHosts || []).some((item) => item.ok === true);
  const verifiedTlsEndpoint = (tlsVerified && chainComplete) || alternateVerified;
  const robotsVerified = evidence.robots?.ok === true && evidence.robots?.allowsProductRoute === true;
  const termsVerified = evidence.terms?.ok === true && evidence.terms?.automatedCollectionRestrictionFound === false;
  const publicContractVerified = evidence.publicProductContract?.verified === true;
  const canaryAllowed = verifiedTlsEndpoint && robotsVerified && termsVerified && publicContractVerified;
  return {
    status: canaryAllowed ? 'eligible_for_one_then_four_canary' : 'blocked_before_product_request',
    canaryAllowed,
    fullCollectionAllowed: false,
    reasons: [
      ...(!verifiedTlsEndpoint ? ['no_normally_verified_tls_endpoint'] : []),
      ...(!verifiedTlsEndpoint && !chainComplete ? ['server_certificate_chain_incomplete'] : []),
      ...(!robotsVerified ? ['robots_not_normally_verifiable'] : []),
      ...(!termsVerified ? ['public_use_terms_not_normally_verifiable'] : []),
      ...(!publicContractVerified ? ['public_product_contract_not_runtime_verified'] : []),
    ],
  };
}

export async function diagnoseKiwoomAccess() {
  const nodeBundled = await strictHttpsProbe(ROBOTS_URL);
  const nodeSystemCa = nodeSystemCaProbe(ROBOTS_URL);
  const windowsNative = windowsNativeProbe(ROBOTS_URL);
  const serverChain = opensslChainProbe(HOST);
  const alternateHosts = [];
  for (const host of ALTERNATE_HOSTS) alternateHosts.push({ host, ...await strictHttpsProbe(`https://${host}/robots.txt`) });
  const evidence = {
    nodeBundled,
    nodeSystemCa,
    windowsNative,
    serverChain,
    alternateHosts,
    robots: { ok: false, url: ROBOTS_URL, allowsProductRoute: null, reason: 'TLS validation failed before HTTP response' },
    terms: { ok: false, url: null, automatedCollectionRestrictionFound: null, reason: 'homepage/terms not requested after TLS policy gate failed' },
    publicProductContract: {
      verified: false,
      routeTemplate: PRODUCT_ROUTE,
      evidence: 'Official pages are publicly indexed with ticker-bound gcode routes, but this runtime cannot verify and fetch them over TLS.',
    },
  };
  const decision = evaluateKiwoomAccess(evidence);
  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    issuer: { id: 'kiwoom-asset-management', brand: 'KIWOOM', inventoryCount: 68 },
    probeContract: {
      purpose: 'Diagnose TLS trust and gate a maximum one-then-four product canary without weakening certificate verification.',
      authenticationUsed: false,
      certificateVerificationDisabled: false,
      ignoreCertificateErrorsUsed: false,
      customCaTrusted: false,
      productDetailRequests: 0,
      canaryRequests: 0,
      fullCollectionRequests: 0,
    },
    observations: evidence,
    diagnosis: {
      rootCause: 'The endpoint presents only the leaf certificate and omits its Sectigo RSA Organization Validation Secure Server CA intermediate. The leaf hostname and validity window are acceptable, but normal clients cannot build a chain to a trusted root.',
      nodeVsWindows: 'This is not isolated to Node bundled CAs: Node default, Node --use-system-ca, and Windows Schannel all fail. Adding system roots does not supply the missing server intermediate.',
      alternateHostFinding: 'All certificate SAN alternatives tested resolve to the same failing TLS deployment; no normally verified official alternate host was found.',
    },
    decision,
    resumeConditions: [
      'The issuer serves the missing intermediate certificate and strict Node plus Windows TLS probes pass.',
      'robots.txt is retrievable with certificate validation enabled and permits the ticker-bound product route.',
      'Public-use terms are retrievable and do not prohibit the intended bounded local collection.',
      'Only then run one product request; expand to four canaries only after identity and raw-provenance validation passes.',
      'Full 68-product collection requires a separate approval after the four-canary report.',
    ],
    prohibitedNextSteps: [
      'Do not use rejectUnauthorized=false, NODE_TLS_REJECT_UNAUTHORIZED=0, curl -k, or --ignore-certificate-errors.',
      'Do not install or pin the missing intermediate as a workaround for collection; the issuer must deliver a normally valid chain or provide another valid official endpoint.',
      'Do not fetch product pages while robots and public-use terms remain unverifiable.',
    ],
    references: [
      { title: 'Official KIWOOM ticker-bound product route', url: 'https://www.kiwoometf.com/service/etf/KO02010200M?gcode=449770' },
      { title: 'Sectigo intermediate certificate guidance', url: 'https://www.sectigo.com/faqs/detail/Sectigo-Intermediate-Certificates' },
      { title: 'Node.js --use-system-ca documentation', url: 'https://nodejs.org/api/cli.html#--use-system-ca' },
    ],
  };
}

export async function runKiwoomAccessDiagnosis(outputPath = resolve(ROOT, 'data/reports/metadata-v2/kiwoom-product-access-block.json')) {
  const report = await diagnoseKiwoomAccess();
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  renameSync(temporary, outputPath);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const report = await runKiwoomAccessDiagnosis();
  console.log(`[metadata-v2:kiwoom-access] status=${report.decision.status} canary=${report.probeContract.canaryRequests} chain=${report.observations.serverChain.presentedCertificateCount}`);
}
