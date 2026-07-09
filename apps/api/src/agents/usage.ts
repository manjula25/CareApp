/**
 * S18 WSA — Token usage capture for the four LLM agents.
 *
 * The OpenAI Responses API (used by `riskAgent`, `careGapAgent`,
 * `sdohAgent`, `actionPlannerAgent` via `client.responses.create({ stream:
 * true })`) returns a `response.completed` event at the end of each streamed
 * call whose `response.usage` field carries `{ input_tokens, output_tokens,
 * total_tokens }`. `extractUsage` pulls that out as a typed `UsageRecord`;
 * `accumulateUsage` sums N per-agent records into one per-patient total.
 *
 * **Null-safe, never fabricate.** If `response.usage` is absent (e.g. a
 * streaming interruption, a partial cache, or an SDK quirk), `extractUsage`
 * returns `null` — the eval cost-aggregator renders `null` cells as `—` in
 * the markdown, NOT `$0.00`. This is the `never-override-real-with-fake`
 * invariant: when the real LLM doesn't tell us what it spent, we say
 * "unknown," not "free." See `prd-s18.md` §"Compliance with
 * never-override-real-with-fake.md".
 *
 * **No LLM calls, no Date.now() at module scope, no I/O.** Pure functions
 * only — testable without API keys, network, or time mocking.
 */

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Pulls the `usage` field off a `response.completed` event payload. Returns
 * `null` (not a default UsageRecord, not a fabricated 0) when:
 *   - the event is `undefined` or `null` (null-safety);
 *   - `event.response` is absent;
 *   - `event.response.usage` is absent;
 *   - any of `input_tokens`, `output_tokens`, `total_tokens` is missing or
 *     not a finite number.
 *
 * The OpenAI Responses SDK's streaming event shape is `{ type,
 * response: { id, output, usage? } }`; we accept that and any reasonable
 * variants without throwing — the eval pipeline handles `null` cleanly.
 */
export function extractUsage(event: unknown): UsageRecord | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as { response?: unknown };
  if (!e.response || typeof e.response !== 'object') return null;
  const r = e.response as { usage?: unknown };
  if (!r.usage || typeof r.usage !== 'object') return null;
  const u = r.usage as { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown };
  if (
    typeof u.input_tokens !== 'number' || !Number.isFinite(u.input_tokens) ||
    typeof u.output_tokens !== 'number' || !Number.isFinite(u.output_tokens) ||
    typeof u.total_tokens !== 'number' || !Number.isFinite(u.total_tokens)
  ) return null;
  return { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens };
}

/**
 * Sums N `UsageRecord`s into one. Returns `{0, 0, 0}` for an empty array —
 * a degenerate but valid case (one patient produced no live orchestrator
 * runs, e.g. all-cached). The eval cost section renders that patient as
 * `—` for the cost cell rather than `$0.0000` (see eval.ts cost renderer).
 */
export function accumulateUsage(records: UsageRecord[]): UsageRecord {
  let inputTokens = 0, outputTokens = 0, totalTokens = 0;
  for (const r of records) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    totalTokens += r.totalTokens;
  }
  return { inputTokens, outputTokens, totalTokens };
}