---
name: html-mockup-fidelity
description: Implement or restyle a screen against its matching reference-materials/*.html mockup with real structural fidelity, not just design tokens. Use before writing or changing any apps/web screen/component that has a matching reference HTML file, or when asked to check/verify visual fidelity to a mockup.
---

# HTML Mockup Fidelity

For screens with a matching mockup, `reference-materials/*.html` is the visual
source of truth — not the token summary in `HANDOFF.md` §4. Pulling colors and
type scale from §4 and inventing your own layout produces a screen that looks
CareSync-branded but isn't the screen that was designed. That gap is exactly
what happened in commit `97a1a4f`: screens were built from tokens alone,
missed the header compliance pills, the risk-dot + condition-tag patient list,
and the patient-detail top bar, and had to be rebuilt against the actual
markup.

## When this applies

Any implementation-time task (inside `subagent-driven-development` or done
directly) that creates or restyles a component under `apps/web/src/` which
corresponds to a screen listed in `HANDOFF.md` §5. If no matching reference
exists yet, skip this skill and build to the `HANDOFF.md` §4 tokens instead,
flagging the screen as a placeholder pending a mockup — don't invent a new
visual language to fill the gap.

## The loop

1. **Find the reference.** Match the screen to its file by `<title>` or the
   screen name in `HANDOFF.md` §5 (e.g. "Web Dashboard — Care Coordinator
   Command Center" → `caresync-ai.html`).
2. **Read the actual markup and CSS**, not just skim it for hex codes. Note:
   - Layout regions (panel widths, grid/flex structure, header height).
   - Component patterns: list-row structure, badge/pill shapes, status-color
     mapping, card anatomy.
   - Spacing scale and type scale as used in context, not just declared in a
     tokens block.
3. **Build against that structure.** Reuse the mockup's DOM shape (which
   elements nest inside which) and class-level patterns, translated into the
   framework's component model — don't just copy inline styles.
4. **Self-check against the fidelity bar** before calling the screen done:
   - [ ] Layout regions match (same panels/columns, same rough proportions).
   - [ ] Component patterns match (list rows, badges, status colors render the
     same way, not just similar colors).
   - [ ] Color and type tokens match `HANDOFF.md` §4.
   - [ ] Spacing scale matches.
   - Target **≥80%** on this checklist for any screen with a reference. Below
     that, keep iterating before moving on.
5. **Handle content the mockup shows but the codebase can't back yet**
   (data from an agent/slice that doesn't exist yet, like the mockup's "Run
   Analysis" button and agent-feed panels before S2/S3 land). Leave it out
   rather than shipping inert chrome — a button or panel with no behavior
   behind it is worse than not having it. Record the omission and why in the
   slice's verification notes (`tasks/todo.md` or
   `docs/plans/{PLAN_ID}/verification.md`), per `CLAUDE.md`'s "UI
   implementation" rule.
6. **Record any other intentional deviation** (mockup detail dropped or
   changed on purpose) in the same verification notes, with the reason.

## Anti-patterns

- **Token-only build** — extracting colors/fonts from `HANDOFF.md` §4 and
  designing the layout from scratch. Passes a color-palette eyeball check,
  fails structural fidelity.
- **Pixel-chasing without semantics** — copying inline styles verbatim
  without understanding what pattern they express (e.g. hardcoding one
  badge's color instead of implementing the status→color mapping), so the
  next status value breaks the pattern.
- **Shipping inert chrome** — rendering a mockup element that has no backing
  data or behavior yet, instead of omitting it and noting the gap.
