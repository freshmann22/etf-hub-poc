# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ETF 허브 PoC — a mobile-first (390×844) Korean ETF app. It started as a single **main-screen** hub (zero-dependency static frontend) and has since grown a **Node data-supply backend** plus a **second prototype screen** (탐색→상세):

- **`index.html`** — the original main hub (market summary, heatmap, ranking, stock→ETF reverse search, theme cards, comparison, content, bottom sheet). Contract-bound and unit/Playwright-verified. Detail screens/charts were out of scope for *this* screen.
- **`etf-explore.html`** — a newer 탐색(browse by category/chip)→상세(detail with 요약/구성종목/수익률/배당 tabs) prototype, styled in the iM design system with **Spoqa Han Sans Neo**. It consumes real data (Toss live prices/candles, 공공데이터포털 universe, CSV holdings, WiseReport metadata) with honest sample/fixture fallbacks. This screen is **not** bound by the main-screen contract/content tests, but keep the same design tokens and no-real-order policy.

The original CLAUDE guidance said "all local sample data, no external APIs" — that is now **outdated**. The app runs in `mock` (fixture only) by default and can be promoted to `live`/`hybrid` with real provider credentials in `.env`.

## Commands

```bash
npm test                 # all unit tests (node --test, no runner dependency) — 98 tests across 6 files
npm run serve            # integrated server (static + /api) at http://localhost:4173  (server/index.js)
npm run explore          # same server + auto-opens the 탐색 page in a browser (scripts/launch.mjs)
npm run serve:static     # legacy static-only server (scripts/dev-server.js), also mounts /api
```

- **Run one test file:** `node --test tests/server.test.mjs`. The `test` script lists all 6 files explicitly on purpose — `node --test tests/` (directory arg) fails on Windows.
- **Windows launcher:** double-click **`start-etf.cmd`** to start (server + opens `etf-explore.html`); close the window / Ctrl+C to stop (single process, no orphan). `stop-etf.cmd` force-frees port 4173.
- **`etf-explore.html` must be served over http** — opening the file directly (`file://`) shows a blank page because ES modules and `/api` are blocked. Screen verification is done with the Playwright MCP against the running server (the MCP browser is shared with the user's real browsing).
- **Data pipelines** (Node scripts that emit `public/data/*.json` consumed by `explore.js`):
  - `npm run build:data` — CSV (`spikes/krx-direct/reports/naver_top10_holdings_full.csv`) → `public/data/etf-holdings.json` (top-10 구성종목 per ETF).
  - `npm run metadata:all` then `npm run metadata:web` — scrape/normalize ETF metadata → `public/data/etf-metadata.json` (운용사/총보수/상장일/베타/배당일정; low coverage, mostly WiseReport-scraped ETFs).
  - `npm run tagging:*` — sector/strategy/dividend taxonomy tagging; the scoring/audit steps run via the `etf-scoring-worker`/`etf-scoring-reviewer`/`etf-taxonomy-auditor` subagents (see `.claude/agents/`), not an external LLM API.
- Python (separate from `npm test`): `python scripts/test_date_resolution.py`. `scripts/collect_etf_holdings.py` / `pykrx_benchmark.py` need `pip install pykrx` (optional).

## Frontend architecture

The `src/js/` layer split is a hard contract, not a convention. Interactions must change real data, not just toggle button styles.

- **`logic.js`** — pure functions only, no DOM/`window` (importable in Node for tests), never mutates arguments. Error messages are fixed Korean strings tests match literally (e.g. `throw new Error('알 수 없는 순위 탭: ' + tab)`). Sorting/filtering/search/comparison/formatting core (main hub).
- **`data.js`** — all fixture data as named exports (`etfs`, `themes`, `stocks`, `holdings`, `contents`, `marketSummaryByPeriod`, `comparisonSets`). Missing numbers are `null` (never `0`/`undefined`). `topHoldings`/`stocks.relatedEtfIds` are derived from `holdings`; referential integrity enforced by `tests/data-integrity.test.mjs`. This fixture is also the **mock provider's** data source.
- **`render.js`** / **`app.js`** — main-hub DOM rendering + single `state` object and event wiring. Browser-only (Playwright-verified, not unit-tested).
- **`dataSource.js`** — `loadData()` fetches `/api/bundle` and maps it to the fixture collection shape; falls back to importing `./data.js` on any failure or `file://`. This is what decouples the UI from the backend.
- **`explore.js`** (+ `src/styles/explore.css`) — the 탐색→상세 prototype app. Reuses `dataSource.loadData()` for the list; per-ETF detail hits `/api/etf/:code/{price,candles}`; holdings via `getEtfHoldings()` (CSV JSON) and summary/dividend via `getEtfMeta()` (metadata JSON). Sparklines/1M are computed from Toss candles for the *visible* rows (lazy + cached), decorative fallback for uncovered codes.

## Backend: data-supply layer (`server/`)

`server/index.js` serves static files **and** the API. The layers are deliberately decoupled so the UI never knows about providers/CSV/columns.

- **`config.js`** — loads `.env` (Node `process.loadEnvFile`). `ETF_DATA_MODE` = `mock` | `live` | `hybrid`. Provider credentials/toggles (`TOSS_CLIENT_ID/SECRET`, `DART_API_KEY`, `PUBLICDATA_SERVICE_KEY`+`PUBLICDATA_ENABLED`, `KRX_ENABLED`, …). **Never** logs/returns secret values (`describeConfig()` only reports configured/unconfigured). Only `.env.example` is committed; `.env` is git-ignored and filled by the user.
- **`providers/`** — one class per source, all extending `BaseProvider` (`types.js`) with a capability map. `registry.js` builds them from config. Real ones: **`toss`** (live prices/candles via OAuth2), **`publicdata`** (공공데이터포털 = ETF universe/master + T+1 snapshot, the only source that enumerates all ~1141 ETFs), **`dart`** (전자공시). **`mock`** always available (reads the fixture). `krx`/`kind`/`seibro`/`broker`/`issuer` are best-effort/stub. Unimplemented paths return `NOT_IMPLEMENTED`/`unavailable` — never fabricated data.
- **`services/etf-service.js`** — orchestrates by `mode` × per-capability provider preference, wrapped in a TTL+SWR cache. `live` never fabricates (honest `unavailable`); `hybrid` falls back to `mock` and flags it in `meta.fallback`. `getBundle()` assembles the UI bundle: fixture structural scaffold (themes/holdings relations/comparison sets) + **publicdata universe (all ~1141 ETFs merged as thin entries onto the curated 24)** + Toss real-price overlay + derived theme/market aggregates. `getEtfCandles()` paginates Toss (see below).
- **`routes/api.js`** — GET-only: `/api/{health,config,providers,bundle}` and `/api/etf/:code/{price,summary,holdings,performance,distributions,disclosures,candles}`. Data absence returns 200 + envelope with `meta.status` (honest), not 4xx.
- **`lib/`** — `normalize.js`, `http.js` (host allowlist + timeout + finite backoff + size cap), `cache.js` (TTL + stale-while-revalidate + in-flight dedup), `errors.js` (`ProviderError` + status enums). All data objects are `{ data, meta }` envelopes; numbers are raw (`number|null`), display formatting is the frontend's job.

### Real-data gotchas (learned the hard way)

- **ETF codes can be alphanumeric.** Newer ETFs use KRX 단축코드 like `0000D0`, not 6-digit numeric. `normalizeCode()` strips letters (it's for numeric stock codes) and corrupts these → use **`normalizeEtfCode()`** (in `server/lib/normalize.js`) at the service layer and **`tossSymbol()`** in the Toss provider. Getting this wrong silently drops ~274 ETFs from Toss coverage.
- **Toss token is single-flight.** Toss enforces "1 client, 1 token; reissuing invalidates the previous one instantly." Concurrent token requests 401 each other, so `TossProvider._accessToken()` dedups in-flight issuance. Repeatedly reissuing (e.g. many debug script runs) can trigger a temporary 403 rate-limit on the token endpoint.
- **Toss candles max 200 per call**, interval `1m`|`1d` only. `TossProvider.getCandles()` paginates via the `before`/`nextBefore` cursor when `count > 200` (used for 1Y=250 / 3Y=750 daily bars). No 5-minute interval exists — the list sparkline downsamples 1m candles.
- **公共데이터 is T+1** (previous business day). Good for universe/master/순자산, not intraday. Toss supplies live/intraday; Toss data availability is tied to the environment's simulated "today".

## Holdings & metadata pipelines

- **Holdings** — `server/holdings/` is a **separate** provider-agnostic pipeline (its own JSON Schema `schemas/etf-holdings.schema.json`, `constants.js` enums, `normalizer.js`, `schemaValidator.js` + `businessValidator.js`, `orchestrator.js` fallback chain, `repository.js` = `getEtfHoldings`/`getEtfHoldingSummary`/`getCollectionStatus`). Providers read fixtures or return `NOT_IMPLEMENTED`. This backs the mock e2e; the actual 구성종목 shown in `etf-explore.html` currently come from `public/data/etf-holdings.json` (the CSV pipeline). `docs/ETF_DATA_CONTRACT.md` is its spec. **pykrx cannot supply real holdings in this environment** (structural EMPTY — see `docs/ETF_DATA_BACKLOG.md` / `ETF_PYKRX_BENCHMARK_REVIEW.md`); KRX has no constituent API, so the real path is SEIBro/운용사/금투협 (open backlog).
- **Metadata** — `data/raw/` (WiseReport/naver scrapes) → `data/normalized/etf-metadata.json` → `public/data/etf-metadata.json`. Config-driven source registry in `config/etf-data-sources.json`. Coverage is low (~22 ETFs with fees/issuer/listing/beta); the UI fills real values where present and keeps `[샘플]`-tagged dummies otherwise.
- **Adapter boundary:** the UI only calls `getEtfHoldings(code)` / `getEtfMeta(code)` in `explore.js` — never CSV paths or column names. Swapping CSV→API/DB later means changing only those adapters + the endpoint, not the screen.

## The contract & content policy (main hub)

`INTERFACE_CONTRACT.md` is the single spec that main-hub implementation and tests follow. Before changing data schemas, function signatures, error strings, `data-testid`s, or required copy, update the contract first.

- **`data-testid`s** (≈25) and required Korean copy (sample notice, search placeholder, empty states) must be preserved on `index.html`.
- **Content policy** (`tests/content-policy.test.mjs`, scans `index.html` + `src/js/*.js` — so **`explore.js`/`dataSource.js` are scanned too**): forbidden inducement substrings (추천/지금 사야/매수·매도 타이밍/목표가격/자금 유입 계열, …). The buy/sell/order **button** regex check runs on `index.html` only, which is why `etf-explore.html` can show 매수/매도 as **non-functional disabled placeholders** (tapping shows a "후속 범위" notice; no real order). Up/down shown with `+`/`-` signs, not color alone. **Up = red, down = blue** (Korean convention).
- **Brand color** = iM Mint **`#00C7A9`** (UI accents only — active tabs, selection, focus; never the up/down color). The deep-teal `#007CA9` seen in early drafts was a digit-transposition typo; do not reintroduce it.

Doc priority when they conflict: `PROJECT_BRIEF.md` → `INTERFACE_CONTRACT.md` → `docs/POC_SCOPE_MATRIX.md` → `docs/UX_SCREEN_SPEC.md` → `docs/SAMPLE_DATA_SPEC.md` → `docs/ACCEPTANCE_TEST_PLAN.md` → `docs/MULTI_AGENT_PROJECT_RULES.md` → `MULTI_AGENT_WORKFLOW.md`.

## Multi-agent workflow

Developed with the `/multi-agent-start` flow (`MULTI_AGENT_WORKFLOW.md`): orchestrator + implementer + independent test/review. `MULTI_AGENT_RUN_LOG.md` records each step (S1…S16+), test results, and rework. File ownership is disjoint: implementation = `index.html`/`src/**`; tests = `tests/**` (written from the contract, never reads implementation); orchestration = contract/log/`package.json`/`scripts/dev-server.js`. Custom subagents live in `.claude/agents/`: `implementer` (product code), and the tagging trio `etf-scoring-worker` / `etf-scoring-reviewer` / `etf-taxonomy-auditor` (they ARE the inference engine — no external LLM calls). The `server/**` data layer is net-new territory added by the main session outside the original multi-agent contract.
