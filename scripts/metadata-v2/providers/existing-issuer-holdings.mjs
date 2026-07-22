import { IssuerProvider } from '../../../server/providers/issuer/index.js';
import { MetadataProbeProvider, PROBE_STATUS, makeProbeResult } from './contract.mjs';

export class ExistingIssuerHoldingsProbe extends MetadataProbeProvider {
  constructor(source, { providerFactory } = {}) {
    super(source);
    this.providerFactory = providerFactory || (() => new IssuerProvider({ enabled: true, timeoutMs: 8000, retries: 1 }));
  }

  async probe(canary) {
    const startedAt = new Date().toISOString();
    try {
      const envelope = await this.providerFactory().getEtfHoldings(canary.etfCode);
      const rows = Array.isArray(envelope?.data) ? envelope.data : [];
      const upstreamStatus = envelope?.meta?.status || null;
      const expectedSource = this.source.sourceId;
      const actualSource = envelope?.meta?.source || null;
      if (rows.length > 0 && actualSource !== expectedSource) {
        throw new Error(`issuer mismatch: expected ${expectedSource}, received ${actualSource || 'unknown'}`);
      }
      const status = rows.length === 0
        ? PROBE_STATUS.EMPTY
        : upstreamStatus === 'partial'
          ? PROBE_STATUS.PARTIAL
          : PROBE_STATUS.OK;
      return makeProbeResult({
        source: this.source,
        canary,
        status,
        fields: { holdings: rows.length > 0 },
        diagnostics: {
          rowCount: rows.length,
          asOfDate: envelope?.meta?.asOfDate || rows.find((row) => row.asOfDate)?.asOfDate || null,
          upstreamStatus,
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      return makeProbeResult({
        source: this.source,
        canary,
        status: PROBE_STATUS.FAILED,
        error,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    }
  }
}
