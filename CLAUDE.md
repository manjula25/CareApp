# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

<!-- FILL IN once the POC stack is chosen — one paragraph: language/runtime, what
     the system does, the major moving parts, and any auth/roles or persistence
     that matter. Keep it grounded in the actual source, not aspirations. -->

A **POC** built and evolved through the **ADLC (AI Development Life-Cycle)** — a
document-backed, agent-driven flow where every feature moves through design →
PRD → issues → plan → implementation → verification → review before it ships.
The lifecycle is enforced by the repo-local Claude Code skills under
`.claude/skills/` (see **ADLC lifecycle** below).

## Read the docs first

Before non-trivial work, read the project context files:

- `docs/agents/issue-tracker.md` — where issues live and how to operate on them (GitHub or Bitbucket).
- `docs/agents/domain.md` — domain glossary + required-reading rules (read the current plan's artifacts and any relevant ADRs before acting). <!-- generate if missing -->
- Any `CONTEXT.md` and ADRs under `docs/adr/` for the area you're touching.

`docs/` is the source of truth for how the POC is meant to work; keep it current as the POC evolves.

## ADLC lifecycle

This repo uses repo-local Claude Code skills under `.claude/skills/`. The
lifecycle is **file-backed**: each feature gets a working directory
`docs/plans/{PLAN_ID}/` (where `{PLAN_ID}` is the feature slug / branch name;
ask if ambiguous) and each phase writes one artifact that the next phase reads.

**This is a Jira-free POC.** Work starts from a design or requirements
document, not from a ticket. The artifact chain is:

```
design.md / grill.md  →  prd.md  →  issues.md  →  implementation-plan.md  →  verification.md  →  review.md
```

The phases and the skills that drive them:

| Phase | Skills | Output |
|-------|--------|--------|
| **1. Understand & design** | `research`, `domain-modeling`, `codebase-design`, `grilling` / `grill-with-docs` | `design.md`, `grill.md` |
| **2. Specify** | `to-prd`, then `to-issues` | `prd.md`, `issues.md` |
| **3. Plan & simplify** | `writing-plans`, then `ponytail` | `implementation-plan.md` |
| **4. Implement** | `subagent-driven-development` (loads `tdd`, uses `using-git-worktrees`); `diagnosing-bugs` and `improve-codebase-architecture` as needed. For any screen with a matching `reference-materials/*.html` mockup, also loads `html-mockup-fidelity`; for any change to what a screen renders or how it behaves, also loads `frontend-e2e-verification` (test-first, per screen) | code + tests |
| **5. Verify & review** | `verification-before-completion` (for UI-visible changes, requires `frontend-e2e-verification` evidence before it), then `code-review` | `verification.md`, `review.md` |
| **6. Ship** | `finishing-a-development-branch`, `handoff` | PR + context handoff |

`wayfinder` coordinates larger efforts across phases via a map issue plus child
tickets (see the wayfinding section of `docs/agents/issue-tracker.md`).

Rules:

- **Don't code directly from a PRD or design doc.** Always go through the simplified `implementation-plan.md`.
- **The order is specified in two consistent places.** The phase table above is the canonical map; each pipeline skill also closes with a `## Next step` section naming its successor (`grill-with-docs` → `to-prd` → `to-issues` → `writing-plans` → `ponytail` → `subagent-driven-development` → `verification-before-completion` → `code-review` → `finishing-a-development-branch` → `handoff`). The real glue is `{PLAN_ID}` artifact threading: each stage reads the previous stage's committed file under `docs/plans/{PLAN_ID}/`. This is convention, not harness-enforced — you can still invoke any skill out of order.
- **`## Next step` ≠ `## Handoff`.** In the wrapper skills, `## Handoff` delegates the wrapper to its `superpowers:*` base skill (same stage); `## Next step` advances to the next lifecycle stage. A few skills are on-demand helpers, not stages, and have no `## Next step`: `research`, `codebase-design`, `domain-modeling`, `grilling`, `tdd`, `using-git-worktrees`, `diagnosing-bugs`, `improve-codebase-architecture`, `wayfinder`, `handoff`, `html-mockup-fidelity`, `frontend-e2e-verification`.
- **`{PLAN_ID}` resolution** and where plan artifacts get committed are defined in `docs/agents/issue-tracker.md`.
- **Triage labels are not configured** for this POC. Don't invent labels or move issues unless explicitly asked.
- **Always use the repo-local versions** of shared-name skills (`tdd`, `grilling`, `codebase-design`, `domain-modeling`, `diagnosing-bugs`, `code-review`) — plugin/global skills with the same names may differ.

## Commands

<!-- FILL IN for the POC stack. Examples below — replace with the real targets. -->

- Setup: `<install deps>`
- Run the app: `<run command>`
- Test: `<full test suite>` — single file: `<focused test command>`
- Format / lint: `<formatter>` / `<linter>`
- Build / package: `<build command>`

## Code style

<!-- FILL IN: line length, naming conventions, framework/version choices,
     import rules, async vs sync. Point at the config file that enforces it. -->

## UI implementation

- `reference-materials/*.html` are the visual source of truth (HANDOFF.md §4/§5) — colors, layout, component structure, and spacing, not just the token summary in HANDOFF.md §4. Before building or restyling any screen, run the `html-mockup-fidelity` skill, which walks the match-by-title, read-the-markup, build-against-structure, and self-check loop.
- Target **at least 80% visual/structural fidelity** to the matching reference for any screen that has one — layout regions, component patterns (e.g. list-row structure, badges/pills, status colors), color/type tokens, and spacing scale should all match, not just the color palette. Record any intentional deviation and why (e.g. content that depends on a not-yet-built agent/slice) in the slice's verification notes.
- If no reference screen exists yet for a given view, build to the design tokens in HANDOFF.md §4 and flag it as a placeholder pending a mockup — don't invent a new visual language.

## Verification rules

- Run a focused test for the touched module first, then the full suite when feasible.
- If a change mutates persisted state, verify the returned payload, any emitted event, the persisted file, and any audit/log side effect.
- Local / mock-mode success is not proof of target-environment (hardware, cloud, client) acceptance.
- Do not mark a phase complete until `verification-before-completion` has actually exercised the change end-to-end.
- For any change to what a screen renders or how it behaves, "exercised end-to-end" means a real (headless) browser run via the `frontend-e2e-verification` skill, not an API/curl-level check alone.

## Evidence boundaries

Do not claim real-environment acceptance (hardware, cloud, target OS, auth, TLS)
from source review or local mock tests alone. Label evidence by its strength:
source-level, local mock, packaged UI, target environment, hardware, cloud, or
client-accepted.

## Repo etiquette

Branch off `main` (e.g. `feature/*`, `fix/*`, `docs/*`), push, and open a PR
against `main` — no direct commits to `main`. Works the same whether the POC is
hosted on GitHub (`gh`) or Bitbucket (REST API); see `docs/agents/issue-tracker.md`.
