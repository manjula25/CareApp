/**
 * S18 WSA — TDD pins for `apps/api/src/agents/pricing.ts`. Pure function:
 *   - `computeCostUsd(usage, model)`: returns the USD cost for a given
 *     UsageRecord at a given model's published rate. Returns `null` for
 *     unknown models (NOT a fabricated $0.00). Rates are sourced from
 *     `https://openai.com/pricing` snapshot 2026-07-09 — see `pricing.ts`
 *     header comment for the audit trail.
 *
 * Pricing rationale (per `prd-s18.md` D3):
 *   - `gpt-5.5` is the canonical model for all 4 agents today (one tier).
 *     The PRD explicitly defers per-agent tier routing to S19; the WSA
 *     rate table is the data S19 will need to compare against.
 *   - `gpt-5.5-mini` is the planned fallback tier for the 3 classifier
 *     agents (Risk / CareGap / SDOH) per the plan; `gpt-5.5` stays for
 *     Action Planner. S19 wires this; WSA only seeds the rate table.
 *   - `computeCostUsd` is testable without an LLM call (pure function on
 *     a literal UsageRecord). The eval cost section is built by iterating
 *     `accumulateUsage` results through `computeCostUsd`.
 *
 * TDD discipline: tests written RED first (this file), then
 * `apps/api/src/agents/pricing.ts` lands GREEN.
 */

import { computeCostUsd, RATE_TABLE } from './pricing';

describe('pricing.ts — S18 WSA TDD pins', () => {
  describe('computeCostUsd', () => {
    it('computes gpt-5.5 cost: 1000 input + 200 output tokens = $0.045 (input $0.025/1k + output $0.10/1k)', () => {
      // 1000/1000 * 0.025 + 200/1000 * 0.10 = 0.025 + 0.020 = 0.045
      const usage = { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 };
      expect(computeCostUsd(usage, 'gpt-5.5')).toBe(0.045);
    });

    it('computes gpt-5.5-mini cost: 1000 input + 200 output tokens at $0.005/$0.02 per 1k = $0.009 (cheaper than gpt-5.5)', () => {
      // 1000/1000 * 0.005 + 200/1000 * 0.02 = 0.005 + 0.004 = 0.009
      const usage = { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 };
      const miniCost = computeCostUsd(usage, 'gpt-5.5-mini');
      const fullCost = computeCostUsd(usage, 'gpt-5.5');
      expect(miniCost).toBe(0.009);
      expect(miniCost).toBeLessThan(fullCost as number);
    });

    it('returns null for an unknown model (NOT fabricated $0.00 — per never-override-real-with-fake)', () => {
      const usage = { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 };
      expect(computeCostUsd(usage, 'unknown-model-xyz')).toBeNull();
    });

    it('rounds to 4 decimal places (avoids floating-point drift in eval-report aggregates)', () => {
      // 7/1000 * 0.025 + 13/1000 * 0.10 = 0.000175 + 0.0013 = 0.001475 → rounds to 0.0015
      const usage = { inputTokens: 7, outputTokens: 13, totalTokens: 20 };
      expect(computeCostUsd(usage, 'gpt-5.5')).toBe(0.0015);
    });

    it('returns 0 cost for a zero-usage record (degenerate but valid)', () => {
      const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      expect(computeCostUsd(usage, 'gpt-5.5')).toBe(0);
    });
  });

  describe('RATE_TABLE', () => {
    it('contains exactly the 2 published rates (gpt-5.5 + gpt-5.5-mini) as of 2026-07-09', () => {
      expect(Object.keys(RATE_TABLE).sort()).toEqual(['gpt-5.5', 'gpt-5.5-mini']);
    });
  });
});