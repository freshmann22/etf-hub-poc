# Official holdings collection

- Generated: 2026-07-21T06:27:37.513Z
- Targets: 544
- Attempted unique: 307
- Pending/resumable: 263
- Status: ok=281, partial=0, empty=0, failed=25, rate_limited_stopped=1, access_blocked_stopped=0
- Rate-limited sources stopped: issuer_kodex

| Source | Targets | Attempted | Completed | Pending | Latest statuses |
| --- | ---: | ---: | ---: | ---: | --- |
| issuer_tiger | 229 | 229 | 229 | 0 | ok=229 |
| issuer_kodex | 238 | 1 | 0 | 238 | rate_limited_stopped=1 |
| issuer_sol | 77 | 77 | 52 | 25 | ok=52, failed=25 |

## Blocking observations

- issuer_kodex: persistent 429 from www.samsungfund.com
- issuer_sol: upstream 403 from www.soletf.com

Raw responses are append-only under `data/raw/metadata-v2/official-holdings/`; the JSONL ledger is the resume source of truth.
