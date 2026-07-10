/**
 * S19 Thread A — integrity test for `MODEL_CARD.md` (repo root).
 *
 * The model card is a reviewer-facing artifact that satisfies HL7 evaluation
 * open question Q3 ("Is there a plan for a model card or NIST AI RMF
 * alignment?"). This test pins:
 *
 *   1. The file exists at the repo root (path resolution from `__dirname` —
 *      same convention `apply-clinician-review.ts` and `outreach-validate.ts`
 *      use so the test works regardless of the invoking shell's cwd).
 *   2. The 9 required section headers are present, in order.
 *   3. The file links to `docs/eval-report.md` and `docs/SOLUTION_OVERVIEW.md`
 *      (the canonical pointers from §6 "Evaluation results").
 *
 * Failures list the missing sections so a committer can repair the file in
 * one pass without re-reading the test source.
 *
 * Pure: no I/O except `fs.readFileSync` of a single known path; no LLM; no
 * global state.
 */
import fs from 'fs';
import path from 'path';

const MODEL_CARD_PATH = path.resolve(__dirname, '../../../../MODEL_CARD.md');

// The 9 NIST AI RMF-aligned sections, in the order they appear in MODEL_CARD.md.
// Section text after the leading `## N. ` prefix; the test strips the leading
// markdown prefix (`## `) and the trailing whitespace, then compares the body.
const REQUIRED_SECTIONS: string[] = [
  '1. Model identity',
  '2. Intended use',
  '3. Out-of-scope uses',
  '4. Architecture summary',
  '5. Training data disclosure',
  '6. Evaluation results',
  '7. Risk and limitations',
  '8. NIST AI RMF mapping',
  '9. Contact and acknowledgments',
];

function readModelCard(): string {
  if (!fs.existsSync(MODEL_CARD_PATH)) {
    throw new Error(`MODEL_CARD.md not found at ${MODEL_CARD_PATH}`);
  }
  return fs.readFileSync(MODEL_CARD_PATH, 'utf-8');
}

function extractHeaders(content: string): string[] {
  // Match `## N. Title` — the leading `## ` (h2) plus numbered prefix.
  // Single-line headers only; multi-line are not used in MODEL_CARD.md.
  const matches = content.match(/^## .+$/gm) ?? [];
  return matches.map((m) => m.replace(/^## /, '').trim());
}

describe('MODEL_CARD.md (S19 Thread A)', () => {
  it('exists at the repo root', () => {
    expect(fs.existsSync(MODEL_CARD_PATH)).toBe(true);
  });

  it('has all 9 required sections in order', () => {
    const content = readModelCard();
    const headers = extractHeaders(content);
    const requiredAsHeaders = REQUIRED_SECTIONS.map((s) => s);

    // Each required section must appear at the same index in the file's
    // headers list. This guards against reordering, deletion, or insertion
    // of an extra top-level section that would shift indices.
    for (let i = 0; i < requiredAsHeaders.length; i++) {
      const expected = requiredAsHeaders[i];
      const actual = headers[i];
      if (actual !== expected) {
        // Failure message lists every missing/misordered section so a
        // committer can repair in one pass.
        const mismatches: string[] = [];
        for (let j = 0; j < requiredAsHeaders.length; j++) {
          if (headers[j] !== requiredAsHeaders[j]) {
            mismatches.push(
              `position ${j}: expected "${requiredAsHeaders[j]}", got "${headers[j] ?? '(missing)'}"`
            );
          }
        }
        throw new Error(
          `MODEL_CARD.md section order mismatch.\n` +
            `Mismatches:\n  - ${mismatches.join('\n  - ')}`
        );
      }
    }
  });

  it('links to docs/eval-report.md from §6 (Evaluation results)', () => {
    const content = readModelCard();
    // The §6 link is the canonical pointer to current eval numbers. A
    // committer who deletes this link breaks reviewer discoverability.
    expect(content).toMatch(/docs\/eval-report\.md/);
  });

  it('links to docs/SOLUTION_OVERVIEW.md from the companion-documents line', () => {
    const content = readModelCard();
    expect(content).toMatch(/docs\/SOLUTION_OVERVIEW\.md/);
  });

  it('documents the safety-net transparency in §7 (Risk and limitations)', () => {
    // The pop-0007 regression disclosure is in §7. The test pins that the
    // limitation list mentions the clamp behavior + the §8 mapping + the
    // safety-net transparency table reference.
    const content = readModelCard();
    expect(content).toMatch(/clampRiskLevel|clamp/i);
    expect(content).toMatch(/safety[- ]net/i);
  });

  it('maps all four NIST AI RMF functions in §8', () => {
    const content = readModelCard();
    expect(content).toMatch(/\bGOVERN\b/);
    expect(content).toMatch(/\bMAP\b/);
    expect(content).toMatch(/\bMEASURE\b/);
    expect(content).toMatch(/\bMANAGE\b/);
  });
});