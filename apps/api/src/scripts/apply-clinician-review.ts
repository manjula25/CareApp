/**
 * S14 Commit 2 — `npm run review:apply`. Consumes `labels.clinician-review.json`
 * (downloaded from the `review:render` HTML form) and writes the reviewer's
 * overrides back into `data/eval/labels.json`.
 *
 * Mirrors `scripts/render-clinician-review.ts`'s conventions: I/O-heavy
 * filesystem script with `main()` guarded by `require.main === module`, path
 * resolution from `__dirname` (not `process.cwd()`). The round-trip test
 * lives in `apply-clinician-review.test.ts` (jest), not inline.
 *
 * The render side (`buildOutput()` in render-clinician-review.ts:317-358)
 * stores each (patient, dim) as three independent fields:
 *   { endorsed: bool, abstained: bool, overrideExpected<Field>: bool|null, notes }
 * where the `overrideExpected<Field>` value is:
 *   - the override value parsed from the form (true|false|null) when the
 *     reviewer's choice was 'override', OR
 *   - the original label's value (default) when the reviewer endorsed or
 *     abstained.
 * The choice is recovered from the JSON flags:
 *   abstained === true               → 'abstain'
 *   else endorsed === true           → 'endorse'
 *   else (both false)                → 'override'
 *
 * Per-dim apply rules (per prd-s14.md D3 + grill-secondary-gaps.md §3):
 *   - choice === 'override'  → set the corresponding expected* field to
 *                              overrideExpected*; populate clinicianOverride
 *                              slot; flip `source: 'clinician'`.
 *   - choice === 'abstain'   → leave value unchanged; record abstained=true;
 *                              populate slot; flip `source: 'clinician'`.
 *   - all dims 'endorse'     → leave values unchanged; record endorsement;
 *                              KEEP `source: 'dev'` (the reviewer engaged
 *                              but agreed, so the row stays dev-labeled with
 *                              the audit trail under clinicianOverride).
 *
 * Untouched patients (not present in the review JSON) pass through
 * unchanged. Validation runs BEFORE any labels mutation: an invalid review
 * throws and `labels.json` on disk is byte-identical to before.
 */
import fs from 'fs';
import path from 'path';

const LABELS_PATH = path.resolve(__dirname, '../../../../data/eval/labels.json');
const REVIEW_PATH_CWD = 'labels.clinician-review.json';

// --- Types ----------------------------------------------------------------

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

// The review JSON's per-dim shape matches the render output exactly.
interface CareGapReview {
  endorsed: boolean;
  abstained: boolean;
  overrideExpectedHasGap: boolean | null;
  notes: string;
}
interface RiskReview {
  endorsed: boolean;
  abstained: boolean;
  overrideExpectedHighRisk: boolean | null;
  notes: string;
}
interface SdohReview {
  endorsed: boolean;
  abstained: boolean;
  overrideExpectedHasBarrier: boolean | null;
  notes: string;
}
interface PatientReview {
  patientId: string;
  originalSource: string;
  source: string;
  reviewedAt: string;
  careGap: CareGapReview;
  risk: RiskReview;
  sdoh: SdohReview;
  actionPlanner: { notes: string };
}
interface ReviewFile {
  reviewer: string;
  reviewedAt: string;
  source: string;
  labelsFile: string;
  evalReportFile: string;
  patients: PatientReview[];
}

// `clinicianOverride` slot shape after apply (the post-apply field the test
// inspects and the eval-report's disclosure reads from).
export interface ClinicianOverrideDim {
  endorsed: boolean;
  abstained: boolean;
  overrideValue?: boolean | null;
  notes: string;
}
export interface ClinicianOverride {
  reviewer: string;
  reviewedAt: string;
  dims: {
    careGap: ClinicianOverrideDim;
    risk: ClinicianOverrideDim;
    sdoh: ClinicianOverrideDim;
  };
}

export interface Summary {
  updated: number;
  endorsed: number;
  abstained: number;
  override: number;
  errors: string[];
  reviewer: string;
}

type Choice = 'endorse' | 'override' | 'abstain';
type BinaryDim = 'careGap' | 'risk' | 'sdoh';

// --- Helpers --------------------------------------------------------------

/**
 * Reconstruct the reviewer's choice from the JSON flags.
 *  - abstained=true                            → 'abstain'
 *  - else endorsed=true                        → 'endorse'
 *  - else (endorsed=false AND abstained=false) → 'override'
 */
function deriveChoice(dim: { endorsed: boolean; abstained: boolean }): Choice {
  if (dim.abstained) return 'abstain';
  if (dim.endorsed) return 'endorse';
  return 'override';
}

// --- Public API -----------------------------------------------------------

/**
 * Apply a `labels.clinician-review.json` to a `data/eval/labels.json` file.
 *
 * Returns a `Summary`. Throws a single `Error` (with a multi-line message)
 * on validation failure — in that case `labels.json` on disk is NOT mutated
 * (validation runs before any write).
 *
 * @param reviewPath  Path to the JSON downloaded by the `review:render`
 *                    HTML form's "Download Reviewed Labels" button.
 * @param labelsPath  Path to the committed ground-truth labels file.
 *                    Defaults to the committed path (`LABELS_PATH`).
 */
export function applyReview(reviewPath: string, labelsPath: string = LABELS_PATH): Summary {
  if (!fs.existsSync(reviewPath)) {
    throw new Error(`review file not found: ${reviewPath}. Run \`npm run review:render\` first, fill the form, and download the JSON.`);
  }
  if (!fs.existsSync(labelsPath)) {
    throw new Error(`labels file not found: ${labelsPath}. Run \`npm run import\` first.`);
  }

  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf-8')) as ReviewFile;
  const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf-8')) as LabelsFile;

  // --- Validation (before any mutation) ---------------------------------
  const labelPatientsById = new Map<string, LabelRow>();
  for (const p of labels.patients) {
    labelPatientsById.set(p.patientId, p);
  }

  const errors: string[] = [];
  for (const pr of review.patients) {
    if (!labelPatientsById.has(pr.patientId)) {
      errors.push(
        `unknown patient ID in review: ${pr.patientId}. Run \`npm run review:render\` first to ensure the review only covers labeled patients.`
      );
      continue;
    }
    const careGapChoice = deriveChoice(pr.careGap);
    const riskChoice = deriveChoice(pr.risk);
    const sdohChoice = deriveChoice(pr.sdoh);
    if (careGapChoice === 'override' && (pr.careGap.overrideExpectedHasGap !== true && pr.careGap.overrideExpectedHasGap !== false && pr.careGap.overrideExpectedHasGap !== null)) {
      errors.push(`${pr.patientId}:careGap override value must be true | false | null`);
    }
    if (riskChoice === 'override' && (pr.risk.overrideExpectedHighRisk !== true && pr.risk.overrideExpectedHighRisk !== false && pr.risk.overrideExpectedHighRisk !== null)) {
      errors.push(`${pr.patientId}:risk override value must be true | false | null`);
    }
    if (sdohChoice === 'override' && (pr.sdoh.overrideExpectedHasBarrier !== true && pr.sdoh.overrideExpectedHasBarrier !== false && pr.sdoh.overrideExpectedHasBarrier !== null)) {
      errors.push(`${pr.patientId}:sdoh override value must be true | false | null`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`review:apply validation failed:\n${errors.join('\n')}`);
  }

  // --- Apply --------------------------------------------------------------
  let updated = 0;
  let endorsed = 0;
  let abstained = 0;
  let overrideCount = 0;
  const reviewer = review.reviewer || 'anonymous';

  for (const pr of review.patients) {
    const patient = labelPatientsById.get(pr.patientId);
    if (!patient) continue; // defensive — already validated

    const careGapChoice = deriveChoice(pr.careGap);
    const riskChoice = deriveChoice(pr.risk);
    const sdohChoice = deriveChoice(pr.sdoh);

    const hasOverride = careGapChoice === 'override' || riskChoice === 'override' || sdohChoice === 'override';
    const hasAbstain = careGapChoice === 'abstain' || riskChoice === 'abstain' || sdohChoice === 'abstain';
    const allEndorse = careGapChoice === 'endorse' && riskChoice === 'endorse' && sdohChoice === 'endorse';
    // Per grill-secondary-gaps.md §3: a row is "touched" when ANY dim is
    // non-endorse OR ANY dim carries non-empty notes. The notes trigger is
    // deliberate — a reviewer who adds a clinical observation without
    // overriding still contributed clinician input, and the eval-report's
    // "X of N clinician-validated" disclosure should count them.
    const hasNotes = !!(pr.careGap.notes?.trim() || pr.risk.notes?.trim() || pr.sdoh.notes?.trim());

    // 1. Flip source — touched by override, abstain, OR non-empty notes.
    if (hasOverride || hasAbstain || hasNotes) {
      patient.source = 'clinician';
    }

    // 2. Populate clinicianOverride slot whenever the reviewer engaged with
    //    the row (any of override / abstain / all-endorse).
    if (hasOverride || hasAbstain || allEndorse) {
      const buildDim = (choice: Choice, dim: { endorsed: boolean; abstained: boolean; notes: string }, overrideField: BinaryDim): ClinicianOverrideDim => ({
        endorsed: dim.endorsed,
        abstained: dim.abstained,
        ...(choice === 'override' ? { overrideValue: extractOverrideValue(overrideField, dim) } : {}),
        notes: dim.notes,
      });
      patient.clinicianOverride = {
        reviewer,
        reviewedAt: pr.reviewedAt,
        dims: {
          careGap: buildDim(careGapChoice, pr.careGap, 'careGap'),
          risk: buildDim(riskChoice, pr.risk, 'risk'),
          sdoh: buildDim(sdohChoice, pr.sdoh, 'sdoh'),
        },
      };
    }

    // 3. Apply the override value to the corresponding label field, but
    //    ONLY when the choice was 'override'. For 'abstain' or 'endorse',
    //    the value is left unchanged.
    if (careGapChoice === 'override') {
      patient.careGap.expectedHasGap = pr.careGap.overrideExpectedHasGap;
    }
    if (riskChoice === 'override') {
      patient.risk.expectedHighRisk = pr.risk.overrideExpectedHighRisk;
    }
    if (sdohChoice === 'override') {
      patient.sdoh.expectedHasBarrier = pr.sdoh.overrideExpectedHasBarrier;
    }

    // 4. Summary counts.
    if (hasOverride || hasAbstain) updated++;
    if (allEndorse) endorsed++;
    if (hasAbstain) abstained++;
    if (hasOverride) overrideCount++;
  }

  // --- Persist (2-space JSON, same style as render-clinician-review.ts:362) -
  fs.writeFileSync(labelsPath, JSON.stringify(labels, null, 2), 'utf-8');

  return { updated, endorsed, abstained, override: overrideCount, errors: [], reviewer };
}

function extractOverrideValue(
  dim: BinaryDim,
  review: { [k: string]: unknown },
): boolean | null {
  if (dim === 'careGap') return (review as unknown as CareGapReview).overrideExpectedHasGap;
  if (dim === 'risk') return (review as unknown as RiskReview).overrideExpectedHighRisk;
  return (review as unknown as SdohReview).overrideExpectedHasBarrier;
}

// --- CLI entry ------------------------------------------------------------

function main(): void {
  const reviewPath = path.resolve(process.cwd(), REVIEW_PATH_CWD);
  const summary = applyReview(reviewPath, LABELS_PATH);
  console.log(
    `review:apply: reviewer=${summary.reviewer}, ${summary.updated} rows updated (${summary.override} override, ${summary.abstained} abstain, ${summary.endorsed} endorse), wrote ${LABELS_PATH}`
  );
}

if (require.main === module) {
  main();
}
