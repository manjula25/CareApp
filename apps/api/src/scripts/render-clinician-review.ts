/**
 * S9 C2 — `npm run review:render`. Reads the committed ground-truth label
 * file (`data/eval/labels.json`) + the committed eval run report
 * (`docs/eval-report.json`) and renders a single self-contained HTML file
 * (`docs/eval-clinician-review.html`) the clinician opens in any browser to
 * review each label, see the agent's actual prediction, and record an
 * override that flips the row's `source` from "dev" to "clinician" with no
 * code change. See `data/eval/labels.json`'s `_meta.clinicianStatus` and
 * `eval/computeMetrics.ts` for the consumer contract.
 *
 * Mirrors `scripts/eval.ts`'s existing conventions: no unit test for this
 * glue itself (I/O-heavy — filesystem reads + writes, large template
 * string), `main()` guarded by `require.main === module`, path resolution
 * from `__dirname` (not `process.cwd()`).
 */
import fs from 'fs';
import path from 'path';

const LABELS_PATH = path.resolve(__dirname, '../../../../data/eval/labels.json');
const EVAL_REPORT_PATH = path.resolve(__dirname, '../../../../docs/eval-report.json');
const OUTPUT_PATH = path.resolve(__dirname, '../../../../docs/eval-clinician-review.html');

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
interface EvalReport {
  generatedAt: string;
  errorAnalysis: {
    careGap: { falsePositives: any[]; falseNegatives: any[] };
    risk: { falsePositives: any[]; falseNegatives: any[] };
    sdoh: { disagreements: any[] };
    dataGaps: any[];
  };
}
type BinaryDim = 'careGap' | 'risk' | 'sdoh';
type AgentPrediction =
  | { kind: 'agrees' }
  | { kind: 'disagrees'; expected: boolean; predicted: unknown; labelNotes: string };

// --- Lookup ---------------------------------------------------------------

/**
 * Joins the eval-report's `errorAnalysis` section onto the label rows by
 * `${patientId}:${dim}`. The eval-report only records DISAGREEMENTS, so a
 * missing key is interpreted as "the agent agreed with the label" (not "we
 * don't know what the agent said") — which is what the clinician needs to
 * see, since the report is the authoritative run record.
 */
function buildAgentPredictionLookup(report: EvalReport): Map<string, AgentPrediction> {
  const m = new Map<string, AgentPrediction>();
  for (const arr of [report.errorAnalysis.careGap.falsePositives, report.errorAnalysis.careGap.falseNegatives]) {
    for (const e of arr) {
      m.set(`${e.patientId}:careGap`, { kind: 'disagrees', expected: e.expected, predicted: e.predicted, labelNotes: e.labelNotes });
    }
  }
  for (const arr of [report.errorAnalysis.risk.falsePositives, report.errorAnalysis.risk.falseNegatives]) {
    for (const e of arr) {
      m.set(`${e.patientId}:risk`, { kind: 'disagrees', expected: e.expected, predicted: e.predictedRiskLevel, labelNotes: e.labelNotes });
    }
  }
  for (const e of report.errorAnalysis.sdoh.disagreements) {
    m.set(`${e.patientId}:sdoh`, { kind: 'disagrees', expected: e.expected, predicted: e.predicted, labelNotes: e.labelNotes });
  }
  return m;
}

// --- HTML helpers ---------------------------------------------------------

function esc(s: string | number | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function expectedToString(v: boolean | null | undefined, dim: BinaryDim): string {
  if (v === true) {
    return dim === 'careGap'
      ? 'Positive — has monitoring gap'
      : dim === 'risk'
        ? 'Positive — high / critical risk'
        : 'Positive — has actionable barrier';
  }
  if (v === false) {
    return dim === 'careGap'
      ? 'Negative — no monitoring gap'
      : dim === 'risk'
        ? 'Negative — low / moderate risk'
        : 'Negative — no actionable barrier';
  }
  return 'Unlabeled — no ground truth';
}

function expectedClass(v: boolean | null | undefined): string {
  if (v === true) return 'tag tag-pos';
  if (v === false) return 'tag tag-neg';
  return 'tag tag-null';
}

function agentPredictionText(dim: BinaryDim, prediction: AgentPrediction | undefined, labelExpected: boolean | null): string {
  if (!prediction || prediction.kind === 'agrees') {
    return 'Agrees with label (not in eval-report error analysis)';
  }
  if (dim === 'risk') {
    return `Disagrees — predicted "${esc(String(prediction.predicted))}" (label expected ${labelExpected ? 'high' : 'low/moderate'})`;
  }
  const predWord = prediction.predicted ? 'positive' : 'negative';
  const expWord = labelExpected ? 'positive' : 'negative';
  return `Disagrees — predicted ${predWord} (label expected ${expWord})`;
}

// --- Section renderers ----------------------------------------------------

function renderBinaryDimFieldset(label: LabelRow, dim: BinaryDim, predictions: Map<string, AgentPrediction>): string {
  const expected =
    (label[dim] as any).expectedHasGap ?? (label[dim] as any).expectedHighRisk ?? (label[dim] as any).expectedHasBarrier;
  const notes = label[dim].notes;
  const prediction = predictions.get(`${label.patientId}:${dim}`);
  const name = `${label.patientId}:${dim}`;
  const disagrees = prediction && prediction.kind === 'disagrees';
  const legend = dim === 'careGap' ? 'Care Gap' : dim === 'risk' ? 'Risk' : 'SDOH';
  return `
      <fieldset class="dim" data-patient="${esc(label.patientId)}" data-dim="${dim}">
        <legend>${legend}</legend>
        <dl>
          <dt>Expected</dt>
          <dd><span class="${expectedClass(expected)}">${esc(expectedToString(expected, dim))}</span></dd>
          <dt>Rationale</dt>
          <dd class="rationale">${esc(notes)}</dd>
          <dt>Agent</dt>
          <dd class="${disagrees ? 'disagree' : 'agree'}">${esc(agentPredictionText(dim, prediction, expected))}</dd>
        </dl>
        <div class="form-row">
          <label class="radio"><input type="radio" name="${esc(name)}" value="endorse" checked> Endorse</label>
          <label class="radio"><input type="radio" name="${esc(name)}" value="override"> Override</label>
          <label class="radio"><input type="radio" name="${esc(name)}" value="abstain"> Abstain</label>
          <select class="override-value" disabled aria-label="Override value">
            <option value="">— new value —</option>
            <option value="true" ${expected === true ? 'selected' : ''}>Positive</option>
            <option value="false" ${expected === false ? 'selected' : ''}>Negative</option>
            <option value="null" ${expected === null ? 'selected' : ''}>Unlabeled</option>
          </select>
          <textarea class="notes" rows="2" placeholder="Notes (optional)"></textarea>
        </div>
      </fieldset>`;
}

function renderActionPlannerFieldset(label: LabelRow): string {
  return `
      <fieldset class="dim qualitative" data-patient="${esc(label.patientId)}" data-dim="actionPlanner">
        <legend>Action Planner <span class="qual">(qualitative — no ground truth)</span></legend>
        <p class="rationale">${esc(label.actionPlanner.notes)}</p>
        <textarea class="notes" rows="2" placeholder="Clinician notes (optional)"></textarea>
      </fieldset>`;
}

function renderPatientSection(label: LabelRow, index: number, predictions: Map<string, AgentPrediction>): string {
  return `
    <section class="patient" id="p-${esc(label.patientId)}">
      <h2><span class="num">${index + 1}.</span> ${esc(label.patientId)}</h2>
      <p class="patient-meta">Source: <code>${esc(label.source)}</code> · FHIR: <code>Patient/${esc(label.patientId)}</code></p>
      ${renderBinaryDimFieldset(label, 'careGap', predictions)}
      ${renderBinaryDimFieldset(label, 'risk', predictions)}
      ${renderBinaryDimFieldset(label, 'sdoh', predictions)}
      ${renderActionPlannerFieldset(label)}
    </section>`;
}

function renderPatientIndex(labels: LabelRow[]): string {
  const items = labels
    .map((l, i) => `<a href="#p-${esc(l.patientId)}">${i + 1}. ${esc(l.patientId)}</a>`)
    .join(' · ');
  return `<nav class="patient-index"><strong>Jump to:</strong> ${items}</nav>`;
}

// --- CSS + JS embedded ----------------------------------------------------

const CSS = `
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; color: #1a1a1a; line-height: 1.5; background: #fff; }
h1 { margin: 0 0 0.5rem 0; font-size: 1.75rem; }
h2 { margin: 2rem 0 0.5rem 0; font-size: 1.15rem; border-bottom: 2px solid #333; padding-bottom: 0.25rem; display: flex; gap: 0.5rem; align-items: baseline; }
h2 .num { color: #888; font-weight: normal; min-width: 2rem; }
header { border-bottom: 2px solid #333; padding-bottom: 1rem; }
header p { margin: 0.5rem 0; }
.status { padding: 0.6rem 0.8rem; background: #fff8e1; border-left: 4px solid #f9a825; font-size: 0.95rem; }
.meta { color: #555; font-size: 0.85rem; }
.instructions { background: #f5f5f5; padding: 0.75rem 1rem; border-left: 4px solid #666; font-size: 0.95rem; }
.reviewer-input { margin-top: 0.5rem; font-size: 0.95rem; }
.reviewer-input input { padding: 0.4rem 0.6rem; font-size: 1rem; min-width: 280px; border: 1px solid #999; border-radius: 3px; }
.patient-index { font-size: 0.9rem; margin: 1rem 0; line-height: 1.8; }
.patient-index a { color: #0066cc; text-decoration: none; }
.patient-index a:hover { text-decoration: underline; }
.patient { margin: 1rem 0 2.5rem 0; }
.patient-meta { color: #555; font-size: 0.85rem; margin: 0 0 0.75rem 0; }
.dim { border: 1px solid #ccc; margin: 0.6rem 0; padding: 0.6rem 0.9rem 0.4rem 0.9rem; border-radius: 4px; background: #fafafa; }
.dim legend { font-weight: 600; padding: 0 0.4rem; }
.dim.qualitative { background: #f0f4f8; }
.dim dl { display: grid; grid-template-columns: 90px 1fr; gap: 0.35rem 0.75rem; margin: 0.4rem 0; font-size: 0.95rem; align-items: start; }
.dim dt { font-weight: 600; color: #555; padding-top: 0.15rem; }
.dim dd { margin: 0; }
.rationale { white-space: pre-wrap; }
.tag { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 3px; font-weight: 600; font-size: 0.9em; }
.tag-pos { background: #ffe5e5; color: #b30000; }
.tag-neg { background: #e5ffe5; color: #006400; }
.tag-null { background: #eee; color: #555; font-style: italic; font-weight: normal; }
.agree { color: #006400; }
.disagree { color: #b30000; font-weight: 600; }
.qual { font-weight: normal; color: #777; font-size: 0.85em; }
.form-row { margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px dashed #ccc; display: grid; grid-template-columns: auto auto auto 140px 1fr; gap: 0.4rem 0.6rem; align-items: center; }
.radio { display: inline-flex; align-items: center; gap: 0.3rem; cursor: pointer; }
.form-row select.override-value { padding: 0.3rem; border: 1px solid #999; border-radius: 3px; font: inherit; }
.form-row textarea.notes { padding: 0.4rem; border: 1px solid #999; border-radius: 3px; min-height: 2.2rem; resize: vertical; font: inherit; grid-column: 1 / -1; }
footer { margin-top: 2rem; padding-top: 1.5rem; border-top: 2px solid #333; }
footer button { background: #0066cc; color: white; border: 0; padding: 0.75rem 1.25rem; font-size: 1rem; border-radius: 4px; cursor: pointer; }
footer button:hover { background: #0055aa; }
footer button:disabled { background: #999; cursor: not-allowed; }
.hint { color: #555; font-size: 0.9rem; }
.hint.danger { color: #b30000; }
code { background: #eee; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.9em; }
@media print {
  footer button, .form-row, .patient-index { display: none; }
  .dim { break-inside: avoid; }
}
`;

const JS = `
(function() {
  var STORAGE_KEY = 'caresync-clinician-review-draft-v1';
  var labelsDataNode = document.getElementById('labels-data');
  var LABELS = JSON.parse(labelsDataNode.textContent);

  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }

  function getState() {
    var state = { reviewer: document.getElementById('reviewer').value, patients: {} };
    $$('.patient').forEach(function(section) {
      var pid = section.id.replace('p-', '');
      var patient = { careGap: {}, risk: {}, sdoh: {}, actionPlanner: {} };
      ['careGap', 'risk', 'sdoh'].forEach(function(dim) {
        var fs = section.querySelector('fieldset[data-dim="' + dim + '"]');
        if (!fs) return;
        var radio = fs.querySelector('input[type=radio]:checked');
        var sel = fs.querySelector('select.override-value');
        var ta = fs.querySelector('textarea.notes');
        patient[dim] = {
          choice: radio ? radio.value : null,
          overrideValue: sel && !sel.disabled ? (sel.value || null) : null,
          notes: ta ? ta.value : ''
        };
      });
      var apFs = section.querySelector('fieldset[data-dim="actionPlanner"]');
      if (apFs) { var apTa = apFs.querySelector('textarea.notes'); patient.actionPlanner = { notes: apTa ? apTa.value : '' }; }
      state.patients[pid] = patient;
    });
    return state;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(getState())); } catch (e) { /* quota / private mode */ }
  }

  function updateSelectEnabled(fs) {
    var radio = fs.querySelector('input[type=radio]:checked');
    var sel = fs.querySelector('select.override-value');
    if (sel) sel.disabled = !(radio && radio.value === 'override');
  }

  function applyState(state) {
    if (!state) return;
    if (state.reviewer) document.getElementById('reviewer').value = state.reviewer;
    Object.keys(state.patients || {}).forEach(function(pid) {
      var section = document.getElementById('p-' + pid);
      if (!section) return;
      var patient = state.patients[pid];
      ['careGap', 'risk', 'sdoh'].forEach(function(dim) {
        var data = patient[dim];
        if (!data) return;
        var fs = section.querySelector('fieldset[data-dim="' + dim + '"]');
        if (!fs) return;
        if (data.choice) {
          var radio = fs.querySelector('input[type=radio][value="' + data.choice + '"]');
          if (radio) { radio.checked = true; updateSelectEnabled(fs); }
        }
        if (data.overrideValue) {
          var sel = fs.querySelector('select.override-value');
          if (sel) sel.value = data.overrideValue;
        }
        var ta = fs.querySelector('textarea.notes');
        if (ta && data.notes) ta.value = data.notes;
      });
      if (patient.actionPlanner && patient.actionPlanner.notes) {
        var apFs = section.querySelector('fieldset[data-dim="actionPlanner"]');
        if (apFs) { var apTa = apFs.querySelector('textarea.notes'); if (apTa) apTa.value = patient.actionPlanner.notes; }
      }
    });
  }

  function toOverride(field, defaultVal, review) {
    var dimReview = (review && review[field]) || {};
    if (dimReview.choice === 'override' && dimReview.overrideValue) {
      var v = dimReview.overrideValue;
      return v === 'true' ? true : v === 'false' ? false : null;
    }
    return defaultVal;
  }

  function buildOutput() {
    var state = getState();
    var now = new Date().toISOString();
    var patients = LABELS.patients.map(function(label) {
      var review = state.patients[label.patientId] || {};
      return {
        patientId: label.patientId,
        originalSource: label.source,
        source: 'clinician',
        reviewedAt: now,
        careGap: {
          endorsed: review.careGap && review.careGap.choice === 'endorse',
          abstained: review.careGap && review.careGap.choice === 'abstain',
          overrideExpectedHasGap: toOverride('careGap', label.careGap.expectedHasGap, review),
          notes: (review.careGap && review.careGap.notes) || ''
        },
        risk: {
          endorsed: review.risk && review.risk.choice === 'endorse',
          abstained: review.risk && review.risk.choice === 'abstain',
          overrideExpectedHighRisk: toOverride('risk', label.risk.expectedHighRisk, review),
          notes: (review.risk && review.risk.notes) || ''
        },
        sdoh: {
          endorsed: review.sdoh && review.sdoh.choice === 'endorse',
          abstained: review.sdoh && review.sdoh.choice === 'abstain',
          overrideExpectedHasBarrier: toOverride('sdoh', label.sdoh.expectedHasBarrier, review),
          notes: (review.sdoh && review.sdoh.notes) || ''
        },
        actionPlanner: {
          notes: (review.actionPlanner && review.actionPlanner.notes) || ''
        }
      };
    });
    return {
      reviewer: state.reviewer || 'anonymous',
      reviewedAt: now,
      source: 'caresync-eval-clinician-review-v1',
      labelsFile: 'data/eval/labels.json',
      evalReportFile: 'docs/eval-report.json',
      patients: patients
    };
  }

  function download() {
    var out = buildOutput();
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'labels.clinician-review.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  document.addEventListener('change', function(e) {
    var t = e.target;
    if (t.matches && t.matches('input[type=radio]')) {
      updateSelectEnabled(t.closest('fieldset'));
    }
    save();
  });
  document.addEventListener('input', function(e) {
    if (e.target.matches && e.target.matches('input, textarea, select')) save();
  });
  document.getElementById('download').addEventListener('click', download);

  try {
    var draft = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (draft) applyState(draft);
  } catch (e) { /* corrupted draft, ignore */ }
})();
`;

// --- Main HTML render -----------------------------------------------------

function renderHtml(labels: LabelRow[], predictions: Map<string, AgentPrediction>, reportGeneratedAt: string, generatedAt: string): string {
  const patientSections = labels.map((l, i) => renderPatientSection(l, i, predictions)).join('\n');
  const patientIndex = renderPatientIndex(labels);
  // The labels-data script tag must escape `<` to prevent </script> injection
  // (data is internal/curated, but the escape is one line and worth the safety).
  const labelsDataJson = JSON.stringify({ patients: labels }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CareSync Eval — Clinician Review</title>
  <style>${CSS}</style>
</head>
<body>
  <header>
    <h1>CareSync Eval — Clinician Review</h1>
    <p class="status"><strong>DEV-LABELED BASELINE, NOT CLINICIAN-VALIDATED (GD8).</strong> Ground truth is drawn from <code>data/eval/labels.json</code> with <code>source: "dev"</code> on every row today. Your review flips a row to <code>source: "clinician"</code> with no code change — see <code>data/eval/labels.json</code> <code>_meta.clinicianStatus</code> for the consumer contract.</p>
    <p class="meta"><strong>Generated:</strong> ${esc(generatedAt)} · <strong>Labels:</strong> ${labels.length} patients · <strong>Eval report:</strong> ${esc(reportGeneratedAt)}</p>
    <p class="instructions">For each patient × dimension, choose one of: <strong>Endorse</strong> the label as-is, <strong>Override</strong> it (pick the new value + explain in notes), or <strong>Abstain</strong> (defer to another reviewer). When done, click <em>Download Reviewed Labels</em> at the bottom. Drafts auto-save to your browser's localStorage as you type — but download before closing the tab.</p>
    <p class="reviewer-input"><label>Reviewer: <input type="text" id="reviewer" placeholder="Name or email (recorded in the downloaded file)"></label></p>
    ${patientIndex}
  </header>
  <main>
${patientSections}
  </main>
  <footer>
    <button id="download" type="button">Download Reviewed Labels</button>
    <p class="hint">Downloads <code>labels.clinician-review.json</code>. Touched rows have <code>source: "clinician"</code> and an <code>override*</code> field; untouched rows are passed through unchanged. Send the file to the team to apply.</p>
    <p class="hint danger"><strong>Heads up:</strong> drafts live in this browser's localStorage only. Clearing browser data loses unsaved work — download before closing the tab.</p>
  </footer>
  <script type="application/json" id="labels-data">${labelsDataJson}</script>
  <script>${JS}</script>
</body>
</html>`;
}

// --- Entry ----------------------------------------------------------------

function main(): void {
  if (!fs.existsSync(LABELS_PATH)) {
    throw new Error(`labels not found: ${LABELS_PATH}. Run \`npm run import\` first.`);
  }
  if (!fs.existsSync(EVAL_REPORT_PATH)) {
    throw new Error(
      `eval report not found: ${EVAL_REPORT_PATH}. Run \`npm run eval\` first — the clinician review form shows the agent's actual prediction per dimension, which only the eval report records.`
    );
  }
  const labels = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8')).patients as LabelRow[];
  const report = JSON.parse(fs.readFileSync(EVAL_REPORT_PATH, 'utf-8')) as EvalReport;
  const predictions = buildAgentPredictionLookup(report);
  const html = renderHtml(labels, predictions, report.generatedAt, new Date().toISOString());
  fs.writeFileSync(OUTPUT_PATH, html, 'utf-8');
  console.log(`review:render: wrote ${OUTPUT_PATH} (${labels.length} patients, ${html.length.toLocaleString()} bytes)`);
}

if (require.main === module) {
  main();
}

export { renderHtml, buildAgentPredictionLookup, LABELS_PATH, EVAL_REPORT_PATH, OUTPUT_PATH };
