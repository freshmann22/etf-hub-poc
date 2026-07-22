import { MetadataProbeProvider, PROBE_STATUS, makeProbeResult } from './contract.mjs';

export class DiscoveryOnlyProbe extends MetadataProbeProvider {
  async probe(canary) {
    return makeProbeResult({
      source: this.source,
      canary,
      status: PROBE_STATUS.BLOCKED_PENDING_TERMS,
      error: new Error('network probe disabled until issuer robots.txt and terms are reviewed'),
    });
  }
}
