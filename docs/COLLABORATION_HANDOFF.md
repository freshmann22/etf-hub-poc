# ETF Explore Collaboration Handoff

## Goal

This repository is the working PoC for a Korean mobile-first ETF exploration service. The product entry point is `http://localhost:4173/`, which serves `etf-explore.html`.

`etf-explore.html` is a reference shell, not the place for parallel feature development. The team will build content modules as independent services, review each module, and integrate only approved modules through a separate integration change. A module must have a clear user surface, data boundary, owner files, and validation evidence.

## Current Product State

- The reference shell is `etf-explore.html`: browse by category and tag, open an ETF detail page, then inspect summary, holdings, returns, and dividends.
- `index.html` is the legacy hub and is no longer served at `/`. Do not use it for new user-facing modules.
- The root server is `server/index.js`; `npm run serve` starts the app at `http://localhost:4173/`.
- ETF lists load through `src/js/dataSource.js`. It uses `/api/bundle` and falls back to fixtures when necessary.
- Explore UI lives in `src/js/explore.js` and `src/styles/explore.css`.
- The current tag briefing pipeline publishes six fixture briefs. On Explore, selecting one of the supported tags displays the matching briefing card above the ETF list.

## Read Before Editing

1. `CLAUDE.md`
2. `docs/COLLABORATION_HANDOFF.md`
3. `TAG_BRIEF_MOVE_TO_EXPLORE.md` for the completed tag-briefing decision record
4. `INTERFACE_CONTRACT.md` when touching shared data or the legacy hub
5. `docs/ETF_DATA_CONTRACT.md` when touching provider, API, holdings, or metadata code

## Repository Layout For New Work

```text
modules/
  <module-name>/
    index.html             # standalone module entry point
    src/                   # module-only UI and state
    fixtures/              # module development data, when needed
    README.md              # module contract and local run instructions
```

- New content work belongs under `modules/<module-name>/` unless an approved integration PR says otherwise.
- A module must run and be reviewable without editing the reference shell.
- Modules may reuse non-UI contracts deliberately, but they must not import `src/js/explore.js` or depend on its DOM.
- Do not add a module to the root route during module development. The integration owner decides how an approved module is mounted.

## Reference And Module Boundaries

| Module | Primary ownership | Shared boundaries to preserve |
| --- | --- | --- |
| Reference shell | `etf-explore.html`, `src/js/explore.js`, `src/styles/explore.css` | Read for visual and interaction reference. Do not edit for a standalone module. |
| Standalone content module | `modules/<module-name>/**` | Keep UI, state, fixtures, and its README self-contained. |
| ETF data supply | `server/**`, `src/js/dataSource.js` | API envelopes remain `{ data, meta }`; never expose secrets or fabricate live data. |
| Holdings and metadata | `server/holdings/**`, `public/data/**`, data scripts | Explore accesses them only through `getEtfHoldings()` and `getEtfMeta()`. |
| Tag taxonomy and briefs | `config/etf-tagging/**`, `data/tagging/**`, `src/js/tag-brief/**`, `scripts/build-tag-briefs.js` | Treat as a separate pipeline. Do not change it for a UI module. |
| Legacy hub | `index.html`, `src/js/app.js`, `src/js/render.js`, `src/styles/main.css` | No new feature work without explicit agreement. Its contract tests remain active. |

## Parallel Development Rules

- One module per branch and one owner per `modules/<module-name>/**` directory. Do not make opportunistic edits in another module or the reference shell.
- Branch from the agreed baseline branch and use `feat/module-<module-name>` naming, for example `feat/module-market-news`.
- Keep data schema changes in a separate PR from visual module changes unless they are inseparable. A shared schema change requires an owner and an explicit compatibility note.
- Do not edit `.env`, `.claude/settings.local.json`, or `docs/.claude/`; they are machine-local.
- Do not modify generated briefing fixtures, taxonomy files, or pipeline tests while implementing a standalone UI module.
- Avoid direct CSV or filesystem reads from UI code. Add or reuse an adapter instead.
- Keep the 390 x 844 viewport free of horizontal scrolling. Up is red, down is blue, and mint is only a UI accent.
- Do not add investment inducement language. `tests/content-policy.test.mjs` scans every file in `src/js`, including Explore.

## Delivery Workflow

1. Create a module branch from the agreed baseline branch.
2. Add `modules/<module-name>/README.md` before or with the first implementation. It must state the user outcome, owned files, input/output contract, fixture sources, run command, and acceptance checks.
3. Implement only the assigned module. Add focused tests when behavior or a shared contract changes.
4. Run `npm test` and the module-specific manual/mobile check.
5. Open a draft module PR. A reviewer checks module isolation, data-boundary compliance, UI behavior, and validation evidence. The module PR must not mount itself into Explore.
6. After approval, merge the module PR into the baseline branch without changing the reference shell.
7. Create a separate `feat/integrate-<module-name>` PR to connect the approved module to the main service. This PR has its own review and full regression check.
8. After each integration merge, run the full suite and a root-route smoke check: `http://localhost:4173/` must render Explore.

## Review Checklist

- The module stays within its declared directory and file ownership.
- The module runs independently and documents its contract.
- The reference shell is unchanged in a module PR.
- For integration PRs, the root route and existing Explore browse-to-detail flow still work.
- UI handles loading, empty, and unavailable data without breaking the screen.
- No horizontal scroll at 390 x 844.
- `npm test` is green.
- No credentials, local editor settings, generated local artifacts, or unrelated refactors are included.

## Current Integration Notes

- `feat/etf-metadata-pipeline` contains the current baseline work.
- `/` now serves `etf-explore.html`; `npm run explore` also opens the same screen.
- The tag briefing UI in the reference shell is intentionally selection-driven, not a combined news feed: a matching brief appears above the filtered ETF list only when its tag chip is selected.
