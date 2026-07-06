import { generatePopulation } from '../fhir-data/population';
import { ALL_PATIENTS, COORDINATOR_PANEL_GROUP_ID, RaceEthnicity, SeedPatient } from '../fhir-data/seed-patients';

// The S5 procedural population cohort (~500 patients) generated once at
// module load so buildBundle() and the Coordinator Group stay in sync; see
// fhir-data/population.ts for the generator and its determinism guarantee.
const POPULATION_PATIENTS = generatePopulation();

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';

async function waitForHapi(maxAttempts = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${FHIR_BASE_URL}/metadata`);
      if (res.ok) return;
    } catch {
      // HAPI not accepting connections yet — retry.
    }
    console.log(`Waiting for HAPI FHIR (attempt ${attempt}/${maxAttempts})...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('HAPI FHIR did not become healthy in time');
}

function raceEthnicityExtensions(re: RaceEthnicity) {
  return [
    {
      url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race',
      extension: [
        {
          url: 'ombCategory',
          valueCoding: { system: 'urn:oid:2.16.840.1.113883.6.238', code: re.raceCode, display: re.raceDisplay },
        },
        { url: 'text', valueString: re.raceDisplay },
      ],
    },
    {
      url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity',
      extension: [
        {
          url: 'ombCategory',
          valueCoding: { system: 'urn:oid:2.16.840.1.113883.6.238', code: re.ethnicityCode, display: re.ethnicityDisplay },
        },
        { url: 'text', valueString: re.ethnicityDisplay },
      ],
    },
  ];
}

function patientResource(p: SeedPatient) {
  return {
    resourceType: 'Patient',
    id: p.id,
    ...(p.raceEthnicity ? { extension: raceEthnicityExtensions(p.raceEthnicity) } : {}),
    name: [{ given: p.name.given, family: p.name.family }],
    gender: p.gender,
    birthDate: p.birthDate,
    // S7 B2 — fabricated demo phone number for the M03 task-detail Call action.
    telecom: p.phone ? [{ system: 'phone', value: p.phone }] : undefined,
  };
}

function conditionResource(patientId: string, c: SeedPatient['conditions'][number]) {
  return {
    resourceType: 'Condition',
    id: c.id,
    clinicalStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
    },
    code: {
      coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: c.code, display: c.display }],
      text: c.display,
    },
    subject: { reference: `Patient/${patientId}` },
    ...(c.onsetDateTime ? { onsetDateTime: c.onsetDateTime } : {}),
  };
}

function observationResource(patientId: string, o: NonNullable<SeedPatient['observations']>[number]) {
  return {
    resourceType: 'Observation',
    id: o.id,
    status: 'final',
    code: {
      coding: [{ system: 'http://loinc.org', code: o.loincCode, display: o.display }],
      text: o.display,
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: new Date().toISOString(),
    valueQuantity: { value: o.value, unit: o.unit },
  };
}

function sdohObservationResource(patientId: string, sdoh: NonNullable<SeedPatient['sdohPositive']>) {
  return {
    resourceType: 'Observation',
    id: sdoh.id,
    status: 'final',
    category: [
      { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'sdoh' }] },
    ],
    code: {
      coding: [{ system: 'http://loinc.org', code: '71802-3', display: 'AHC-HRSN Screening' }],
      text: 'AHC-HRSN Screening',
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: new Date().toISOString(),
    valueString: sdoh.note,
  };
}

function encounterResource(patientId: string, e: NonNullable<SeedPatient['encounter']>) {
  const end = new Date(Date.now() - e.dischargedHoursAgo * 60 * 60 * 1000).toISOString();
  return {
    resourceType: 'Encounter',
    id: e.id,
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'inpatient encounter' },
    subject: { reference: `Patient/${patientId}` },
    reasonReference: [{ reference: `Condition/${e.conditionId}` }],
    period: { end },
    hospitalization: { dischargeDisposition: { text: 'Discharged to home' } },
  };
}

function riskAssessmentResource(p: SeedPatient) {
  return {
    resourceType: 'RiskAssessment',
    id: `${p.id}-risk`,
    status: 'final',
    subject: { reference: `Patient/${p.id}` },
    occurrenceDateTime: new Date().toISOString(),
    prediction: [
      {
        outcome: { text: '30-day readmission risk (seed value; superseded by Risk Agent analysis in S2)' },
        probabilityDecimal: p.riskScore / 100,
      },
    ],
  };
}

const TASK_PRIORITY_TO_FHIR: Record<SeedPatient['tasks'][number]['priority'], string> = {
  critical: 'stat',
  high: 'urgent',
  medium: 'routine',
};

function taskResource(patientId: string, t: SeedPatient['tasks'][number]) {
  return {
    resourceType: 'Task',
    id: t.id,
    status: 'requested',
    intent: 'order',
    priority: TASK_PRIORITY_TO_FHIR[t.priority],
    description: t.description,
    for: { reference: `Patient/${patientId}` },
    authoredOn: new Date().toISOString(),
    restriction: { period: { end: new Date(Date.now() + t.dueInDays * 24 * 60 * 60 * 1000).toISOString() } },
  };
}

function groupResource() {
  return {
    resourceType: 'Group',
    id: COORDINATOR_PANEL_GROUP_ID,
    type: 'person',
    actual: true,
    name: 'Coordinator Demo Panel',
    member: ALL_PATIENTS.map((p) => ({ entity: { reference: `Patient/${p.id}` } })),
  };
}

function putEntry(resource: any) {
  return {
    resource,
    request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` },
  };
}

function buildBundle(): any {
  const entries: any[] = [];
  // Hero/panel patients plus the deterministic S5 population cohort share
  // the same per-patient resource shape, so they're imported together;
  // only the curated Coordinator Group below stays scoped to ALL_PATIENTS.
  for (const p of [...ALL_PATIENTS, ...POPULATION_PATIENTS]) {
    entries.push(putEntry(patientResource(p)));
    for (const c of p.conditions) entries.push(putEntry(conditionResource(p.id, c)));
    for (const o of p.observations ?? []) entries.push(putEntry(observationResource(p.id, o)));
    if (p.sdohPositive) entries.push(putEntry(sdohObservationResource(p.id, p.sdohPositive)));
    if (p.encounter) entries.push(putEntry(encounterResource(p.id, p.encounter)));
    entries.push(putEntry(riskAssessmentResource(p)));
    for (const t of p.tasks) entries.push(putEntry(taskResource(p.id, t)));
  }
  entries.push(putEntry(groupResource()));
  return { resourceType: 'Bundle', type: 'batch', entry: entries };
}

// The full cohort (~500 population patients + hero patients) is several
// thousand entries. A single $batch POST of that size keeps HAPI busy long
// enough that undici's default headers timeout fires before the response
// arrives — even though HAPI commits every entry — so the command reports a
// spurious failure. Chunk into smaller batches: each POST returns quickly, the
// import stays idempotent (PUT entries), and progress is visible.
const BATCH_CHUNK_SIZE = 250;

async function postBatch(entries: any[]): Promise<void> {
  const bundle = { resourceType: 'Bundle', type: 'batch', entry: entries };
  const res = await fetch(FHIR_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/fhir+json' },
    body: JSON.stringify(bundle),
  });
  if (!res.ok) {
    throw new Error(`FHIR $batch import failed: ${res.status} ${await res.text()}`);
  }
  const result = (await res.json()) as { entry?: Array<{ response?: { status?: string } }> };
  const failed = (result.entry ?? []).filter((e) => !e.response?.status?.startsWith('20'));
  if (failed.length > 0) {
    throw new Error(`FHIR $batch import had ${failed.length} failing entries: ${JSON.stringify(failed)}`);
  }
}

async function importBundle(): Promise<void> {
  const { entry } = buildBundle();
  let imported = 0;
  for (let i = 0; i < entry.length; i += BATCH_CHUNK_SIZE) {
    const chunk = entry.slice(i, i + BATCH_CHUNK_SIZE);
    await postBatch(chunk);
    imported += chunk.length;
    console.log(`Imported ${imported}/${entry.length} resources into HAPI FHIR.`);
  }
}

async function main() {
  await waitForHapi();
  await importBundle();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { buildBundle, waitForHapi, importBundle };
