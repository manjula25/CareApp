/**
 * S18 WSA — TDD pins for `apps/api/src/agents/usage.ts`. Pure functions:
 *   - `extractUsage(event)`: pulls `{inputTokens, outputTokens, totalTokens}`
 *     from an OpenAI Responses API `response.completed` event's
 *     `event.response.usage` field. Returns `null` (NOT $0.00, NOT undefined)
 *     when the field is absent or the event is malformed — the eval pipeline
 *     renders `null` cells as `—` in the markdown Cost section, never as
 *     fabricated zeros. (Per `never-override-real-with-fake.md`.)
 *   - `accumulateUsage(records[])`: sums N `UsageRecord`s into one (used by
 *     the eval cost-aggregator when 4 agent calls per patient need to roll
 *     up into a per-patient total).
 *
 * TDD discipline: tests written RED first (this file), then
 * `apps/api/src/agents/usage.ts` lands GREEN.
 */

import { extractUsage, accumulateUsage } from './usage';

describe('usage.ts — S18 WSA TDD pins', () => {
  describe('extractUsage', () => {
    it('returns {inputTokens, outputTokens, totalTokens} from a complete response.completed event', () => {
      const event = {
        type: 'response.completed',
        response: {
          id: 'resp_test_001',
          usage: { input_tokens: 1234, output_tokens: 567, total_tokens: 1801 },
        },
      };
      expect(extractUsage(event)).toEqual({ inputTokens: 1234, outputTokens: 567, totalTokens: 1801 });
    });

    it('returns null when event.response.usage is absent (e.g. streaming interrupted)', () => {
      const event = {
        type: 'response.completed',
        response: { id: 'resp_test_002' }, // no usage field
      };
      expect(extractUsage(event)).toBeNull();
    });

    it('returns null when the event itself is undefined or null (null-safety)', () => {
      expect(extractUsage(undefined)).toBeNull();
      expect(extractUsage(null)).toBeNull();
    });

    it('returns null when usage field is present but missing required number fields', () => {
      const event = {
        type: 'response.completed',
        response: { usage: { input_tokens: 'not-a-number', output_tokens: 567, total_tokens: 1801 } },
      };
      expect(extractUsage(event)).toBeNull();
    });
  });

  describe('accumulateUsage', () => {
    it('sums 4 per-agent UsageRecords into a single per-patient record', () => {
      const records = [
        { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 }, // risk
        { inputTokens: 1100, outputTokens: 180, totalTokens: 1280 }, // careGap
        { inputTokens: 900,  outputTokens: 220, totalTokens: 1120 }, // sdoh
        { inputTokens: 800,  outputTokens: 150, totalTokens: 950  }, // actionPlanner
      ];
      expect(accumulateUsage(records)).toEqual({ inputTokens: 3800, outputTokens: 750, totalTokens: 4550 });
    });

    it('returns zero UsageRecord when the records array is empty', () => {
      expect(accumulateUsage([])).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    });

    it('handles a single record (degenerate case)', () => {
      expect(accumulateUsage([{ inputTokens: 100, outputTokens: 50, totalTokens: 150 }]))
        .toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    });
  });
});