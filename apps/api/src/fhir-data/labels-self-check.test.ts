/**
 * S19 Thread C — verifies `data/eval/labels.json._meta._selfCheck` is
 * internally consistent against the current `generatePopulation()` output.
 *
 * Per `prd-s19.md §Thread C`: "_selfCheck ... reads each `seedRiskScore`
 * and verifies it against current generator output; any mismatch fails
 * the test." This test enforces that contract so a future PRNG seed
 * change, RECENCY_HOURS_OPTIONS cycling change, or
 * buildObservationsForIndex subset change can't drift the labels without
 * a corresponding _selfCheck update.
 *
 * Pure: no I/O except `fs.readFileSync` of `data/eval/labels.json` (the
 * committed ground truth file). Generator runs in-process.
 */
import fs from 'fs';
import path from 'path';
import { generatePopulation } from './population';
import { CRITICAL_RISK_THRESHOLD } from './population';

const LABELS_PATH = path.resolve(__dirname, '../../../../data/eval/labels.json');

interface SelfCheckRow {
  i: number;
  recencyHours: number;
  conditionCount: number;
  expectedRiskScore: number;
  expectedHighRisk: boolean;
}

interface SelfCheckFile {
  _meta: {
    _selfCheck: Record<string, SelfCheckRow | { date: string; description: string; generator: unknown }>;
  };
}

function readSelfCheck(): SelfCheckFile {
  const raw = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8')) as SelfCheckFile;
  return raw;
}

describe('labels.json _selfCheck — every pop-* row matches generatePopulation() output (S19 Thread C)', () => {
  it('every pop-* label has a _selfCheck entry', () => {
    const sc = readSelfCheck();
    const labelsRaw = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8')) as {
      patients: Array<{ patientId: string }>;
    };
    const popIds = labelsRaw.patients.filter((p) => p.patientId.startsWith('pop-')).map((p) => p.patientId);
    const missing = popIds.filter((id) => !sc._meta._selfCheck[id]);
    expect(missing).toEqual([]);
  });

  it('every _selfCheck.expectedRiskScore matches the generator output (drift guard)', () => {
    // Pins the deterministic generator output for every labeled procedural
    // patient. The label's `expectedHighRisk` field is intentionally NOT
    // compared here — it is derived from the v3 rubric's Rule 2 (which
    // considers Anchor A/B/C, not just riskScoreFor ≥ 75), and is allowed
    // to differ from the simple threshold (see grill-s19.md Cross-cut 1
    // for pop-0007's case where the rubric correctly returns 'moderate'
    // for a 2-anchor-without-labs bundle even though the generator's
    // riskScore is 92).
    const sc = readSelfCheck();
    const population = generatePopulation();
    const popById = new Map(population.map((p) => [p.id, p]));

    const errors: string[] = [];
    for (const [patientId, pin] of Object.entries(sc._meta._selfCheck)) {
      // Skip the metadata fields.
      if (patientId === 'date' || patientId === 'description' || patientId === 'generator') continue;
      if (typeof pin !== 'object' || pin === null || !('expectedRiskScore' in pin)) continue;

      const patient = popById.get(patientId);
      if (!patient) {
        errors.push(`${patientId}: not found in generator output`);
        continue;
      }

      if (pin.expectedRiskScore !== patient.riskScore) {
        errors.push(`${patientId}: _selfCheck.expectedRiskScore=${pin.expectedRiskScore} but generator says ${patient.riskScore}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('every label.risk.seedRiskScore matches its _selfCheck pin (internal labels.json consistency)', () => {
    const labelsRaw = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8')) as {
      patients: Array<{ patientId: string; risk: { seedRiskScore?: number } }>;
    };
    const sc = readSelfCheck();
    const errors: string[] = [];
    for (const p of labelsRaw.patients) {
      if (!p.patientId.startsWith('pop-')) continue;
      const pin = sc._meta._selfCheck[p.patientId];
      if (!pin || typeof pin !== 'object' || !('expectedRiskScore' in pin)) {
        errors.push(`${p.patientId}: pin missing`);
        continue;
      }
      if (p.risk.seedRiskScore !== pin.expectedRiskScore) {
        errors.push(`${p.patientId}: label.seedRiskScore=${p.risk.seedRiskScore} != _selfCheck.expectedRiskScore=${pin.expectedRiskScore}`);
      }
    }
    expect(errors).toEqual([]);
  });
});