# ETF metadata source probe

- Generated: 2026-07-21T06:07:09.496Z
- Mode: network_opt_in
- Stratified canaries: 24
- Network canaries executed: 2
- Per-host minimum interval: 1200ms

| Source | Policy | Terms | Canaries | OK | Partial | Failed | Blocked | Holdings |
|---|---|---|---:|---:|---:|---:|---:|---:|
| issuer_kodex | network_opt_in | robots_allow_verified | 4 | 4 | 0 | 0 | 0 | 4 |
| issuer_tiger | network_opt_in | existing_provider_previously_verified | 4 | 0 | 0 | 4 | 0 | 0 |
| issuer_plus | blocked_pending_terms | pending_terms_and_robots_review | 4 | 0 | 0 | 0 | 4 | 0 |
| issuer_rise | blocked_pending_terms | pending_terms_and_robots_review | 4 | 0 | 0 | 0 | 4 | 0 |
| issuer_sol | network_opt_in | robots_allow_and_public_noncommercial_terms_verified | 4 | 2 | 0 | 0 | 0 | 2 |
| issuer_kiwoom | blocked_pending_terms | pending_terms_and_robots_review | 4 | 0 | 0 | 0 | 4 | 0 |

## Interpretation

- `blocked_pending_terms` is intentional: no request is sent until robots.txt and issuer terms are reviewed.
- The existing KODEX/TIGER wrapper currently probes holdings only. Other metadata fields remain false even when holdings succeed.
- This probe is a readiness check, not the 1,141-ETF collection run.
