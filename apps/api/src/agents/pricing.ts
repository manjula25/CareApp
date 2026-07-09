/**
 * S18 WSA — Per-token pricing for the OpenAI models CareSync uses.
 *
 * Rate table source: `https://openai.com/pricing` — snapshot 2026-07-09.
 * If the rates change, update BOTH this file AND the `pricing.ts` header
 * comment together (the audit trail lives in the comment). The eval cost
 * section reports per-patient cost using these rates — a rate change
 * requires regenerating `docs/eval-report.md` via `npx tsx src/scripts/eval.ts`.
 *
 * **Two models in scope today:**
 *   - `gpt-5.5` — the canonical model for all 4 agents (defined as
 *     `MODEL = 'gpt-5.5'` in each `*Agent.ts`; per `prd-s16.md`'s GD13).
 *     This is what the WSA eval regen measures cost against.
 *   - `gpt-5.5-mini` — the planned fallback tier for the 3 classifier
 *     agents (Risk / Care Gap / SDOH). S19 wires per-agent tier routing;
 *     WSA seeds the rate so S19 has the data without a future code change.
 *
 * **Per-agent tier routing is S19, not S18** (see `prd-s18.md`
 * §"Further Notes" + D9). The rate table is forward-compatible — when
 * S19 introduces per-agent routing, `computeCostUsd(usage, 'gpt-5.5-mini')`
 * is already callable.
 *
 * **Unknown models return `null`** — not a fabricated $0.00. The eval
 * pipeline handles `null` cleanly (renders `—`). Per
 * `never-override-real-with-fake.md`.
 *
 * **No I/O, no Date.now() at module scope, no LLM call.** Pure function.
 */

import type { UsageRecord } from './usage';

export const RATE_TABLE: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  // OpenAI gpt-5.5 — reasoning tier. Current production rate.
  // Source: https://openai.com/pricing snapshot 2026-07-09.
  'gpt-5.5':      { inputPer1k: 0.025, outputPer1k: 0.10 },
  // OpenAI gpt-5.5-mini — cheaper tier for classifier agents (S19 routing).
  'gpt-5.5-mini': { inputPer1k: 0.005, outputPer1k: 0.02 },
};

/**
 * Computes the USD cost for a single `UsageRecord` at a given model's
 * published rate. Returns `null` for unknown models (no fabricated $0.00).
 * Round to 4 decimal places to avoid floating-point drift in eval-report
 * aggregates (a 26-patient cohort's per-agent cents-precision noise should
 * not show up at the dollar-precision aggregate).
 */
export function computeCostUsd(usage: UsageRecord, model: string): number | null {
  const rate = RATE_TABLE[model];
  if (!rate) return null;
  const cost =
    (usage.inputTokens / 1000) * rate.inputPer1k +
    (usage.outputTokens / 1000) * rate.outputPer1k;
  return Math.round(cost * 10000) / 10000;
}