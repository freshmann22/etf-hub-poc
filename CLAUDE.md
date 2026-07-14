# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ETF 허브 메인화면 PoC — a mobile-first (390×844) single-page ETF market hub, built as a zero-dependency static frontend (pure HTML/CSS/ES modules, no build step). All data is local sample data; there are no external APIs, auth, or deployment. Scope is deliberately reduced to the **main screen only** — ETF detail screens, price charts, inflection points, contribution analysis, personalization, and alerts are explicitly out of scope (see `docs/POC_SCOPE_MATRIX.md`). Do not add them.

## Commands

```bash
npm test          # run all unit tests (node --test, no runner dependency)
npm run serve     # static server at http://localhost:4173 (scripts/dev-server.js)
```

- Run a single test file: `node --test tests/logic.test.mjs`
- `npm test` lists the three test files explicitly on purpose — `node --test tests/` (directory arg) fails on Windows, so keep the explicit file list in `package.json`.
- Screen verification is done with the Playwright MCP against the running dev server, not a headless test script.

## Architecture

The `src/js/` layer split is a hard contract, not a convention:

- **`logic.js`** — pure functions only. No DOM/`window` access so it is importable in Node for unit tests. Never mutates its array/object arguments (returns new values). Error messages are fixed Korean strings that tests match literally (e.g. `throw new Error('알 수 없는 순위 탭: ' + tab)`). This is the sorting/filtering/search/comparison/formatting core.
- **`data.js`** — all sample data as named exports (`etfs`, `themes`, `stocks`, `holdings`, `contents`, `marketSummaryByPeriod`, `comparisonSets`). Missing numeric values are `null` (never `0`/`undefined`). `topHoldings` and `stocks.relatedEtfIds` are derived from `holdings` to stay consistent. Referential integrity (theme/stock/etf IDs) is enforced by `tests/data-integrity.test.mjs`.
- **`render.js`** — DOM rendering functions. Browser-only.
- **`app.js`** — single `state` object + event wiring; calls `logic.js` then `render.js`. Browser-only, not unit-tested (covered by Playwright instead).

`index.html` + `src/styles/main.css` are the markup/styles. Interactions must change real data, not just toggle button styles.

## The contract is the source of truth

`INTERFACE_CONTRACT.md` is the single spec that both implementation and tests follow. Before changing data schemas, function signatures, error strings, `data-testid`s, or required UI copy, update the contract first — tests assert against these exactly. Key invariants the test suite enforces:

- **`data-testid` attributes** (≈25 of them) and required Korean copy strings (sample-data notice, search placeholder, empty-state messages) must be preserved.
- **Content policy**: `tests/content-policy.test.mjs` fails if any forbidden investment-inducement phrase appears in `index.html` or `src/js/*.js` (추천/지금 사야/매수·매도 타이밍/목표가격/자금 유입 계열, etc.). No 매수/매도/주문 buttons. Price up/down must be shown with `+`/`-` signs, not color alone. Up = red, down = blue (Korean market convention).
- **Brand color**: single point color iM Mint `#00C7A9` for UI accents (active tabs, selection, focus); other iM palette colors are not used on this screen. Mint is UI-accent only — never the up/down semantic color.

When docs conflict, priority is: `PROJECT_BRIEF.md` → `INTERFACE_CONTRACT.md` → `docs/POC_SCOPE_MATRIX.md` → `docs/UX_SCREEN_SPEC.md` → `docs/SAMPLE_DATA_SPEC.md` → `docs/ACCEPTANCE_TEST_PLAN.md` → `docs/MULTI_AGENT_PROJECT_RULES.md` → `MULTI_AGENT_WORKFLOW.md`.

## Multi-agent workflow

This project is developed with the `/multi-agent-start` flow (`MULTI_AGENT_WORKFLOW.md`): Fable orchestrates, Claude Sonnet implements, Codex (MCP) writes tests and reviews independently. File ownership is disjoint and enforced:

- **Implementation (Claude)**: `index.html`, `src/**`
- **Tests (Codex)**: `tests/**` — written from the contract only, never reads implementation files
- **Orchestration (Fable)**: `INTERFACE_CONTRACT.md`, `EXECUTION_PLAN.md`, `MULTI_AGENT_RUN_LOG.md`, `package.json`, `scripts/dev-server.js`

Implementation code must not touch test files to make tests pass, and vice versa. `MULTI_AGENT_RUN_LOG.md` records each step, test results, and rework attributions.
