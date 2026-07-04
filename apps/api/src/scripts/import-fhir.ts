import { ALL_PATIENTS, COORDINATOR_PANEL_GROUP_ID, SeedPatient } from '../fhir-data/seed-patients';

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

function patientResource(p: SeedPatient) {
  return {
    resourceType: 'Patient',
    id: p.id,
    name: [{ given: p.name.given, family: p.name.family }],
    gender: p.gender,
    birthDate: p.birthDate,
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

function taskResource(patientId: string, t: SeedPatient['tasks'][number]) {
  return {
    resourceType: 'Task',
    id: t.id,
    status: 'requested',
    intent: 'order',
    description: t.description,
    for: { reference: `Patient/${patientId}` },
    authoredOn: new Date().toISOString(),
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
  for (const p of ALL_PATIENTS) {
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

async function importBundle(): Promise<void> {
  const bundle = buildBundle();
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
  console.log(`Imported ${bundle.entry.length} resources into HAPI FHIR.`);
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
