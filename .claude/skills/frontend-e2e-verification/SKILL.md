---
name: frontend-e2e-verification
description: Playwright end-to-end verification for frontend screens — drive the rendered app in a real headless browser to prove a UI change works, instead of relying on API/curl-level checks alone. Use before marking frontend/UI work complete, or when asked to add or run E2E tests for a screen.
---

# Frontend E2E Verification

API/curl-level checks prove the backend returns the right payload; they don't
prove a screen renders it, wires it to the right component, or reacts
correctly to a user action. This skill closes that gap with Playwright,
driving the actual rendered app in a headless browser.

This was previously a manual instruction only (`CLAUDE.md`'s "Doing tasks"
section: "start the dev server and use the feature in a browser before
reporting the task as complete") with no enforced mechanism, and Seam 3 —
E2E UI (Playwright) — in `docs/plans/caresync-ai/prd.md` was deferred wholesale
to S12. Confirmed this session: Playwright's bundled Chromium installs and
runs headless in this sandbox (`npx playwright install chromium` + a real
headless smoke test both succeeded). There's no environment blocker — use
this now rather than waiting for S12.

## When this applies

Any task that changes what a screen renders or how it behaves under
`apps/web/src/` — new component, restyle, wired-up interaction, or new route.
Not required for pure backend/API changes with no UI-visible effect.

## Setup (one-time per repo)

Install from the **workspace root**, or with `-w apps/web` — never from
inside `apps/web` directly. Running `npm install` from inside a workspace
member previously corrupted the lockfile's React version resolution (18.3.1
manifest vs. 19.2.7 resolved) and broke tests with a "different copies of
React" crash.

```bash
npm install -D @playwright/test -w apps/web
npx playwright install chromium
```

Keep specs under `apps/web/e2e/` (or promote to a dedicated `apps/e2e`
workspace member later if the suite grows past what one app-scoped folder
should hold — don't build that structure preemptively for a handful of
specs).

## Test-first per screen

Analogous to `tdd`'s red-green loop, but the seam is the rendered DOM instead
of a function call:

1. Write a spec that drives the screen the way a user would (navigate, click,
   type, wait for text) and asserts on rendered output — not on internal
   state or mocked collaborators.
2. Run it and confirm it fails for the right reason (element not found,
   assertion mismatch) before the behavior exists.
3. Implement the minimum change needed to pass.
4. Rerun the spec; rerun the rest of the suite for regressions.

Test only the three demo flows and their key states, per `prd.md`'s Seam 3,
unless the user asks for more:
- **Director** — login → population view → drill into Maria Chen → assign.
- **Coordinator** — open patient → run analysis → findings stream → Tasks
  appear.
- **Social Worker** — mobile queue → open task → mark done → syncs back.

## Running headless

```bash
npx playwright test
```

If the flow needs the full stack (API + HAPI FHIR), bring it up first the
same way `apps/api/src/scripts/import-fhir.ts`'s `waitForHapi()` does —
poll until healthy rather than assuming it's ready.

## Labeling evidence

Per `CLAUDE.md`'s "Evidence boundaries": a headless Playwright run against the
local dev server is **local mock** or **packaged UI** strength — real,
stronger than a curl check, but not target-environment or client-accepted
evidence. Say so explicitly in verification notes rather than implying full
acceptance.

## Anti-patterns

- **Testing through a side channel** — asserting against a mocked API
  response or component internals instead of what actually renders.
- **Horizontal slicing** — writing all E2E specs for every screen before any
  of them pass. Work one flow at a time; each spec is a tracer bullet.
- **Treating a green headless run as full acceptance** — it proves the UI
  works in a headless browser against local/mock data, not against the real
  target environment.
