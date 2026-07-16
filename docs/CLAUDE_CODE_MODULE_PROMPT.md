# Claude Code Prompt: ETF Explore Module Development

Copy the following prompt into Claude Code after cloning this repository.

```text
You are contributing one independently reviewable content module to the ETF Explore PoC.

Repository: etf-hub-poc
First read, in order:
1. CLAUDE.md
2. docs/COLLABORATION_HANDOFF.md
3. TAG_BRIEF_MOVE_TO_EXPLORE.md when working near tag briefs
4. INTERFACE_CONTRACT.md or docs/ETF_DATA_CONTRACT.md when the selected module touches those boundaries

Current product context:
- The service entry point is http://localhost:4173/ and renders etf-explore.html.
- etf-explore.html is a reference shell. Do not edit it, src/js/explore.js, or src/styles/explore.css in a standalone module PR.
- index.html is a legacy route. Do not put new user-facing work there.
- New content modules live in modules/<module-name>/. Keep their UI, state, fixtures, and README self-contained.
- ETF data enters the reference UI through src/js/dataSource.js. Do not read CSV files or pipeline output directly from UI code.
- Tag briefing is a completed pipeline. Do not modify taxonomy, fixtures, generator, or pipeline code for a standalone module.

Your assignment is: <MODULE NAME AND USER OUTCOME>
Allowed files: modules/<MODULE NAME>/**
Do not edit: <EXPLICIT EXCLUSIONS>

Before editing, report:
1. The user behavior you will add or change.
2. Files you will own.
3. The standalone input/output contract and fixture source.
4. Focused acceptance checks.

Implementation rules:
- Work only in the allowed files. If a shared contract change or Explore integration is necessary, stop and describe the separate integration PR needed.
- Preserve the existing mobile 390 x 844 layout without horizontal scrolling.
- Use iM design tokens in src/styles/explore.css. Mint is UI accent only; up is red and down is blue.
- Do not use investment-inducement wording. All src/js files are scanned by the content-policy test.
- Keep real-order actions disabled placeholders only.
- Run npm test before completion.

At completion, provide:
- summary of behavior and files changed
- validation performed and results
- known limitations or follow-up work
- a proposed module PR title and concise review checklist

Do not commit, push, merge, or mount the module into Explore unless explicitly asked.
```
