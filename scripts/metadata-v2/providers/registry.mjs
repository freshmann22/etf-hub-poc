import { ExistingIssuerHoldingsProbe } from './existing-issuer-holdings.mjs';
import { DiscoveryOnlyProbe } from './discovery-only.mjs';
import { SolPublicJsonProbe } from './sol.mjs';

export function createProbeProvider(source, options = {}) {
  if (source.adapter === 'existing_issuer_holdings') return new ExistingIssuerHoldingsProbe(source, options);
  if (source.adapter === 'discovery_only') return new DiscoveryOnlyProbe(source);
  if (source.adapter === 'sol_public_json') return new SolPublicJsonProbe(source, options);
  throw new Error(`unknown probe adapter: ${source.adapter}`);
}
