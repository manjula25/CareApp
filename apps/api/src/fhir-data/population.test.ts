import { ALL_PATIENTS } from './seed-patients';
import { CRITICAL_RISK_THRESHOLD, generatePopulation } from './population';

describe('generatePopulation', () => {
  it('returns roughly 500 patients', () => {
    const population = generatePopulation();
    expect(population.length).toBeGreaterThanOrEqual(480);
    expect(population.length).toBeLessThanOrEqual(520);
  });

  it('is deterministic across calls', () => {
    const first = generatePopulation();
    const second = generatePopulation();
    expect(second).toEqual(first);
  });

  it('gives every patient a numeric riskScore in [0, 100] backing a [0, 1] probabilityDecimal', () => {
    const population = generatePopulation();
    for (const patient of population) {
      expect(typeof patient.riskScore).toBe('number');
      expect(patient.riskScore).toBeGreaterThanOrEqual(0);
      expect(patient.riskScore).toBeLessThanOrEqual(100);
      const probabilityDecimal = patient.riskScore / 100;
      expect(probabilityDecimal).toBeGreaterThanOrEqual(0);
      expect(probabilityDecimal).toBeLessThanOrEqual(1);
    }
  });

  it('has a non-empty critical-zone subset at the documented threshold', () => {
    const population = generatePopulation();
    const critical = population.filter((p) => p.riskScore >= CRITICAL_RISK_THRESHOLD);
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.length).toBeLessThan(population.length);
  });

  it('emits a diabetes, CHF, and depression condition mix across the cohort', () => {
    const population = generatePopulation();
    const hasCode = (codes: string[], code: string) => codes.includes(code);
    let diabetes = 0;
    let chf = 0;
    let depression = 0;
    for (const patient of population) {
      const codes = patient.conditions.map((c) => c.code);
      if (hasCode(codes, 'E11.9')) diabetes++;
      if (hasCode(codes, 'I50.9')) chf++;
      if (hasCode(codes, 'F33.1')) depression++;
    }
    expect(diabetes).toBeGreaterThan(0);
    expect(chf).toBeGreaterThan(0);
    expect(depression).toBeGreaterThan(0);
  });

  it('varies demographics: gender, birthDate, and race/ethnicity', () => {
    const population = generatePopulation();
    const genders = new Set(population.map((p) => p.gender));
    const birthYears = new Set(population.map((p) => p.birthDate.slice(0, 4)));
    const races = new Set(population.map((p) => p.raceEthnicity?.raceCode));
    const ethnicities = new Set(population.map((p) => p.raceEthnicity?.ethnicityCode));

    expect(genders.size).toBeGreaterThan(1);
    expect(birthYears.size).toBeGreaterThan(5);
    expect(races.size).toBeGreaterThan(1);
    expect(ethnicities.size).toBeGreaterThan(1);
    for (const patient of population) {
      expect(patient.raceEthnicity).toBeDefined();
    }
  });

  it('produces unique ids that never collide with hero patient ids', () => {
    const population = generatePopulation();
    const heroIds = new Set(ALL_PATIENTS.map((p) => p.id));
    const popIds = population.map((p) => p.id);
    expect(new Set(popIds).size).toBe(popIds.length);
    for (const id of popIds) {
      expect(heroIds.has(id)).toBe(false);
      expect(id.startsWith('pop-')).toBe(true);
    }
  });
});

describe('buildBundle population wiring', () => {
  it('includes population Patient and RiskAssessment entries alongside the hero cohort', async () => {
    // Import lazily so the generator/test above is exercised even before
    // import-fhir.ts is wired up (this suite should fail RED first).
    const { buildBundle } = await import('../scripts/import-fhir');
    const bundle = buildBundle();
    const population = generatePopulation();

    const patientEntryIds = new Set(
      bundle.entry
        .filter((e: any) => e.resource.resourceType === 'Patient')
        .map((e: any) => e.resource.id),
    );
    const riskEntryIds = new Set(
      bundle.entry
        .filter((e: any) => e.resource.resourceType === 'RiskAssessment')
        .map((e: any) => e.resource.id),
    );

    for (const patient of population) {
      expect(patientEntryIds.has(patient.id)).toBe(true);
      expect(riskEntryIds.has(`${patient.id}-risk`)).toBe(true);
    }

    // Hero patients must still be present too.
    for (const hero of ALL_PATIENTS) {
      expect(patientEntryIds.has(hero.id)).toBe(true);
    }
  });
});
