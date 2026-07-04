// ponytail: Node 22 loads .env natively — no dotenv dependency needed.
// Nothing else loaded .env, so `new OpenAI()` (constructed at import time in
// riskAgent.ts) would throw on a fresh shell even with the key on disk.
// Try apps/api/.env, then fall back to the repo-root .env (where
// OPENAI_API_KEY currently lives); loadEnvFile never overrides vars already
// set (an exported key or the jest.setup placeholder still wins). MUST be
// imported first in index.ts — before the risk agent's `new OpenAI()` runs.
for (const path of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(path);
  } catch {
    // missing file — try the next candidate
  }
}
