/**
 * S14 Commit 2 — round-trip test for `npm run review:apply`.
 *
 * The `review:render` HTML form (apps/api/src/scripts/render-clinician-review.ts)
 * lets a clinician pick Endorse / Override / Abstain per patient × dim. It
 * serializes the result to JSON via `buildOutput()` (render-clinician-review.ts:317).
 * This script consumes that JSON and writes the overrides back into the
 * committed `data/eval/labels.json`.
 *
 * The contract per patient in the review JSON:
 *   { endorsed: bool, abstained: bool, overrideExpected*?: bool|null, notes }
 *
 * The choice is recovered from the JSON flags (the render side stores
 * `endorsed` and `abstained` independently; "override" is implicit when both
 * are false and an `overrideExpected*` is set).
 *
 * Tests cover all three outcomes in ONE round-trip fixture (per plan §A1):
 *   - maria-chen:   one dim override (risk.expectedHighRisk → false)
 *   - james-okafor: all dims endorse (source stays 'dev', clinicianOverride recorded)
 *   - linda-torres: all dims abstain (source flips to 'clinician', values unchanged)
 * Plus a second test (per plan §A3): unknown patient ID in review throws
 * AND labels.json is NOT mutated.
 *
 * Domain rule: tests use `fs.mkdtempSync` (never the committed labels file)
 * and clean up in `afterEach` so the committed ground truth is untouched.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyReview } from './apply-clinician-review';

interface CareGapLabel { expectedHasGap: boolean | null; notes: string }
interface RiskLabel { expectedHighRisk: boolean | null; seedRiskScore?: number; notes: string }
interface SdohLabel { expectedHasBarrier: boolean | null; expectedDomains?: string[]; notes: string }
interface ActionPlannerLabel { notes: string }
interface LabelRow {
  patientId: string;
  source: string;
  clinicianOverride: unknown;
  careGap: CareGapLabel;
  risk: RiskLabel;
  sdoh: SdohLabel;
  actionPlanner: ActionPlannerLabel;
}
interface LabelsFile {
  _meta?: unknown;
  patients: LabelRow[];
}

function fixtureLabels(): LabelsFile {
  return {
    _meta: { test: true },
    patients: [
      {
        patientId: 'maria-chen',
        source: 'dev',
        clinicianOverride: null,
        careGap: { expectedHasGap: false, notes: 'fixture careGap notes' },
        risk: { expectedHighRisk: true, seedRiskScore: 87, notes: 'fixture risk notes' },
        sdoh: { expectedHasBarrier: true, expectedDomains: ['housing'], notes: 'fixture sdoh notes' },
        actionPlanner: { notes: 'fixture ap notes' },
      },
      {
        patientId: 'james-okafor',
        source: 'dev',
        clinicianOverride: null,
        careGap: { expectedHasGap: null, notes: 'fixture careGap notes' },
        risk: { expectedHighRisk: false, seedRiskScore: 62, notes: 'fixture risk notes' },
        sdoh: { expectedHasBarrier: true, expectedDomains: ['transportation'], notes: 'fixture sdoh notes' },
        actionPlanner: { notes: 'fixture ap notes' },
      },
      {
        patientId: 'linda-torres',
        source: 'dev',
        clinicianOverride: null,
        careGap: { expectedHasGap: true, notes: 'fixture careGap notes' },
        risk: { expectedHighRisk: false, seedRiskScore: 71, notes: 'fixture risk notes' },
        sdoh: { expectedHasBarrier: false, notes: 'fixture sdoh notes' },
        actionPlanner: { notes: 'fixture ap notes' },
      },
    ],
  };
}

function fixtureReview(): unknown {
  // Matches the `buildOutput()` shape from render-clinician-review.ts:317-358:
  //   choice → endorsed: bool, abstained: bool, overrideExpected*: bool|null
  //   choice === 'override' ⇔ endorsed=false AND abstained=false
  return {
    reviewer: 'Dr. Casey Review',
    reviewedAt: '2026-07-08T12:00:00.000Z',
    source: 'caresync-eval-clinician-review-v1',
    labelsFile: 'data/eval/labels.json',
    evalReportFile: 'docs/eval-report.json',
    patients: [
      {
        // Maria: reviewer's notes override risk.expectedHighRisk → false.
        // Other dims endorse.
        patientId: 'maria-chen',
        originalSource: 'dev',
        source: 'clinician',
        reviewedAt: '2026-07-08T12:00:00.000Z',
        careGap: {
          endorsed: true,
          abstained: false,
          overrideExpectedHasGap: false, // default value, indicates endorse (not override)
          notes: '',
        },
        risk: {
          endorsed: false,
          abstained: false,
          overrideExpectedHighRisk: false, // the override value: false
          notes: 'Reviewed by Dr. Casey — risk not actually high after medication adjustment',
        },
        sdoh: {
          endorsed: true,
          abstained: false,
          overrideExpectedHasBarrier: true, // default value, indicates endorse
          notes: '',
        },
        actionPlanner: { notes: '' },
      },
      {
        // James: all dims endorse, NO notes. Source stays 'dev'; clinicianOverride
        // slot is still recorded (reviewer engaged with this row). The
        // "endorse-only-with-no-notes" path is the only path that keeps
        // `source: 'dev'` per grill-secondary-gaps.md §3.
        patientId: 'james-okafor',
        originalSource: 'dev',
        source: 'clinician',
        reviewedAt: '2026-07-08T12:00:00.000Z',
        careGap: {
          endorsed: true,
          abstained: false,
          overrideExpectedHasGap: null,
          notes: '',
        },
        risk: {
          endorsed: true,
          abstained: false,
          overrideExpectedHighRisk: false,
          notes: '',
        },
        sdoh: {
          endorsed: true,
          abstained: false,
          overrideExpectedHasBarrier: true,
          notes: '',
        },
        actionPlanner: { notes: '' },
      },
      {
        // Linda: all dims abstain. Per D3, abstain DOES flip source to clinician,
        // but values remain unchanged and abstained=true is recorded per dim.
        patientId: 'linda-torres',
        originalSource: 'dev',
        source: 'clinician',
        reviewedAt: '2026-07-08T12:00:00.000Z',
        careGap: {
          endorsed: false,
          abstained: true,
          overrideExpectedHasGap: true, // default value, indicates abstain
          notes: 'Cannot assess CKD staging',
        },
        risk: {
          endorsed: false,
          abstained: true,
          overrideExpectedHighRisk: false,
          notes: 'Cannot assess',
        },
        sdoh: {
          endorsed: false,
          abstained: true,
          overrideExpectedHasBarrier: false,
          notes: 'Cannot assess',
        },
        actionPlanner: { notes: '' },
      },
    ],
  };
}

function writeJson(p: string, obj: unknown): void {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
}

describe('applyReview (S14 commit 2 — review:apply round-trip)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caresync-apply-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips override + endorse + abstain in one fixture', () => {
    const labelsPath = path.join(tmpDir, 'labels.json');
    const reviewPath = path.join(tmpDir, 'labels.clinician-review.json');
    const labels = fixtureLabels();
    writeJson(labelsPath, labels);
    writeJson(reviewPath, fixtureReview());

    const summary = applyReview(reviewPath, labelsPath);

    const after = JSON.parse(fs.readFileSync(labelsPath, 'utf-8')) as LabelsFile;
    const maria = after.patients.find((p) => p.patientId === 'maria-chen')!;
    const james = after.patients.find((p) => p.patientId === 'james-okafor')!;
    const linda = after.patients.find((p) => p.patientId === 'linda-torres')!;

    // Maria: override flipped risk.expectedHighRisk to false; source flipped to clinician.
    expect(maria.risk.expectedHighRisk).toBe(false);
    expect(maria.source).toBe('clinician');
    expect(maria.clinicianOverride).toBeTruthy();
    expect((maria.clinicianOverride as any).reviewer).toBe('Dr. Casey Review');
    expect((maria.clinicianOverride as any).dims.risk.overrideValue).toBe(false);
    expect((maria.clinicianOverride as any).dims.risk.abstained).toBe(false);
    expect((maria.clinicianOverride as any).dims.risk.endorsed).toBe(false);

    // James: all endorse → source stays dev; clinicianOverride recorded.
    expect(james.source).toBe('dev');
    expect(james.risk.expectedHighRisk).toBe(false); // unchanged
    expect((james.clinicianOverride as any).reviewer).toBe('Dr. Casey Review');
    expect((james.clinicianOverride as any).dims.risk.endorsed).toBe(true);

    // Linda: all abstain → source flips, values unchanged, abstained=true per dim.
    expect(linda.source).toBe('clinician');
    expect(linda.risk.expectedHighRisk).toBe(false); // unchanged
    expect(linda.careGap.expectedHasGap).toBe(true); // unchanged
    expect(linda.sdoh.expectedHasBarrier).toBe(false); // unchanged
    expect((linda.clinicianOverride as any).dims.risk.abstained).toBe(true);
    expect((linda.clinicianOverride as any).dims.careGap.abstained).toBe(true);
    expect((linda.clinicianOverride as any).dims.sdoh.abstained).toBe(true);

    // Summary shape.
    expect(summary).toEqual(
      expect.objectContaining({
        updated: expect.any(Number),
        endorsed: expect.any(Number),
        abstained: expect.any(Number),
        errors: expect.any(Array),
      }),
    );
  });

  it('flips source to clinician when all dims endorse but notes are non-empty (grill §3 "touched" trigger)', () => {
    // Per grill-secondary-gaps.md §3: a row is "touched" (and flips
    // source: 'clinician') when ANY dim is non-endorse OR ANY dim carries
    // non-empty notes. This test pins the notes trigger — the previous
    // round-trip test exercises override + endorse + abstain, but not the
    // "endorse + clinical notes" path that an actual clinician using the
    // form would hit when they want to add context without overriding.
    const labelsPath = path.join(tmpDir, 'labels.json');
    const reviewPath = path.join(tmpDir, 'labels.clinician-review.json');

    const labels = fixtureLabels();
    writeJson(labelsPath, labels);
    const review = fixtureReview() as { patients: Array<{ patientId: string; careGap: any; risk: any; sdoh: any }> };
    // Marge: all endorse BUT with a clinical note on risk.
    // Pre-fix this would stay source: 'dev' (the bug we just fixed).
    const mariaIdx = review.patients.findIndex((p) => p.patientId === 'maria-chen');
    review.patients[mariaIdx] = {
      patientId: 'maria-chen',
      careGap: { endorsed: true, abstained: false, overrideExpectedHasGap: false, notes: '' },
      risk: { endorsed: true, abstained: false, overrideExpectedHighRisk: false, notes: 'Clinically: medication adjustment brings risk below 75 threshold' },
      sdoh: { endorsed: true, abstained: false, overrideExpectedHasBarrier: true, notes: '' },
    };
    writeJson(reviewPath, review);

    applyReview(reviewPath, labelsPath);

    const after = JSON.parse(fs.readFileSync(labelsPath, 'utf-8')) as LabelsFile;
    const maria = after.patients.find((p) => p.patientId === 'maria-chen')!;
    // Source flipped to clinician because of the non-empty note, even though
    // every dim is endorse. Values unchanged (no override happened).
    expect(maria.source).toBe('clinician');
    expect(maria.risk.expectedHighRisk).toBe(true); // unchanged — endorse, not override
    expect((maria.clinicianOverride as any).dims.risk.endorsed).toBe(true);
    expect((maria.clinicianOverride as any).dims.risk.notes).toMatch(/Clinically/);
  });

  it('throws on unknown patient ID and does not mutate labels.json', () => {
    const labelsPath = path.join(tmpDir, 'labels.json');
    const reviewPath = path.join(tmpDir, 'labels.clinician-review.json');

    const labels = {
      _meta: { test: true },
      patients: [
        {
          patientId: 'maria-chen',
          source: 'dev',
          clinicianOverride: null,
          careGap: { expectedHasGap: false, notes: 'pre' },
          risk: { expectedHighRisk: true, notes: 'pre' },
          sdoh: { expectedHasBarrier: true, notes: 'pre' },
          actionPlanner: { notes: '' },
        },
      ],
    };
    const originalContent = JSON.stringify(labels, null, 2);
    writeJson(labelsPath, labels);

    // Review contains a patient ID that doesn't exist in labels.
    const badReview = {
      reviewer: 'Dr. Casey',
      reviewedAt: '2026-07-08T12:00:00.000Z',
      source: 'caresync-eval-clinician-review-v1',
      labelsFile: 'data/eval/labels.json',
      evalReportFile: 'docs/eval-report.json',
      patients: [
        {
          patientId: 'ghost-patient',
          originalSource: 'dev',
          source: 'clinician',
          reviewedAt: '2026-07-08T12:00:00.000Z',
          careGap: {
            endorsed: false,
            abstained: false,
            overrideExpectedHasGap: false,
            notes: '',
          },
          risk: {
            endorsed: false,
            abstained: false,
            overrideExpectedHighRisk: false,
            notes: '',
          },
          sdoh: {
            endorsed: false,
            abstained: false,
            overrideExpectedHasBarrier: false,
            notes: '',
          },
          actionPlanner: { notes: '' },
        },
      ],
    };
    writeJson(reviewPath, badReview);

    // applyReview must throw.
    let caught: unknown;
    try {
      applyReview(reviewPath, labelsPath);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(String((caught as Error)?.message ?? caught)).toMatch(/ghost-patient/);

    // labels.json is unchanged — byte-for-byte equality.
    const after = fs.readFileSync(labelsPath, 'utf-8');
    expect(after).toBe(originalContent);
  });
});
