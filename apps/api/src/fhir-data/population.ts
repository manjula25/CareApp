/**
 * Deterministic procedural population cohort for S5 (~500 patients across
 * diabetes, CHF, and depression condition mixes). This replaces running real
 * Synthea/Java: same inputs, same outputs, every run, so tests and the S5
 * dashboard aggregate can rely on stable counts.
 *
 * IDs are namespaced `pop-0001`..`pop-0500` so they never collide with the
 * hand-authored hero/panel patients in `seed-patients.ts`.
 */

import { RaceEthnicity, SeedPatient } from './seed-patients';

const POPULATION_SIZE = 500;
const POPULATION_SEED = 0xc0ffee;

/**
 * "Critical zone" threshold used by the S5 dashboard to count high-risk
 * patients: a riskScore (0-100, i.e. probabilityDecimal * 100) at or above
 * this value is considered critical. See `riskScoreFor` below for how a
 * patient's score is derived.
 */
export const CRITICAL_RISK_THRESHOLD = 75;

// --- deterministic PRNG -----------------------------------------------
// mulberry32: small, fast, seeded PRNG. No Math.random()/Date.now() — the
// same seed always produces the same sequence, which is what makes
// generatePopulation() reproducible across runs and processes.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

const CONDITION_LIBRARY = {
  diabetes: { system: 'ICD-10' as const, code: 'E11.9', display: 'Type 2 diabetes mellitus without complications' },
  chf: { system: 'ICD-10' as const, code: 'I50.9', display: 'Heart failure, unspecified' },
  depression: { system: 'ICD-10' as const, code: 'F33.1', display: 'Major depressive disorder, recurrent, moderate' },
};

type ConditionKey = keyof typeof CONDITION_LIBRARY;

// Every non-empty subset of {diabetes, chf, depression}, cycled by patient
// index so the cohort covers every mix (single conditions, pairs, and full
// comorbidity) deterministically rather than leaving it to chance.
const CONDITION_MIXES: ConditionKey[][] = [
  ['diabetes'],
  ['chf'],
  ['depression'],
  ['diabetes', 'chf'],
  ['diabetes', 'depression'],
  ['chf', 'depression'],
  ['diabetes', 'chf', 'depression'],
];

const FIRST_NAMES_MALE = ['James', 'Robert', 'Michael', 'David', 'Carlos', 'Anthony', 'Kevin', 'Jamal', 'Wei', 'Dmitri'];
const FIRST_NAMES_FEMALE = ['Maria', 'Linda', 'Angela', 'Patricia', 'Fatima', 'Sofia', 'Aisha', 'Grace', 'Yuki', 'Elena'];
const LAST_NAMES = [
  'Nguyen', 'Garcia', 'Johnson', 'Patel', 'Smith', 'Kim', 'Rossi', 'Diallo', 'Okafor', 'Torres',
  'Martinez', 'Brown', 'Lee', 'Ivanov', 'Silva', 'Cohen', 'Ali', 'Novak', 'Kowalski', 'Santos',
];

// US Core race/ethnicity OMB categories (system urn:oid:2.16.840.1.113883.6.238).
const RACE_OPTIONS: Array<{ raceCode: string; raceDisplay: string }> = [
  { raceCode: '2106-3', raceDisplay: 'White' },
  { raceCode: '2054-5', raceDisplay: 'Black or African American' },
  { raceCode: '2028-9', raceDisplay: 'Asian' },
  { raceCode: '1002-5', raceDisplay: 'American Indian or Alaska Native' },
  { raceCode: '2076-8', raceDisplay: 'Native Hawaiian or Other Pacific Islander' },
  { raceCode: '2131-1', raceDisplay: 'Other Race' },
];
const ETHNICITY_OPTIONS: Array<{ ethnicityCode: string; ethnicityDisplay: string }> = [
  { ethnicityCode: '2135-2', ethnicityDisplay: 'Hispanic or Latino' },
  { ethnicityCode: '2186-5', ethnicityDisplay: 'Not Hispanic or Latino' },
];

// Hours-since-discharge options cycled per patient to vary encounter
// recency, which feeds the risk heuristic below.
const RECENCY_HOURS_OPTIONS = [24, 60, 100, 200, 400, 800, 1500, 3000];

function birthDateFor(rng: () => number): string {
  // Fixed reference year (not Date.now()) keeps birthDate stable across
  // runs/days. Ages span ~28-92 as of the reference year.
  const referenceYear = 2025;
  const age = 28 + Math.floor(rng() * 65);
  const birthYear = referenceYear - age;
  const month = 1 + Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 28);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${birthYear}-${pad(month)}-${pad(day)}`;
}

function raceEthnicityFor(rng: () => number): RaceEthnicity {
  const race = pick(rng, RACE_OPTIONS);
  const ethnicity = pick(rng, ETHNICITY_OPTIONS);
  return { ...race, ...ethnicity };
}

/**
 * Deterministic risk heuristic (documented; not a real clinical model — a
 * stand-in until the S2 Risk Agent scores this cohort for real):
 *
 *   base                = 0.10
 *   + 0.18 * conditionCount        (conditionCount is 1, 2, or 3 of
 *                                    {diabetes, chf, depression})
 *   + recency bonus, from hours since the patient's last encounter ended:
 *       <= 72h   -> +0.20
 *       <= 168h  -> +0.10
 *       <= 720h  -> +0.04
 *       otherwise -> +0.00
 *   + 0.08 comorbidity bonus if all three tracked conditions are present
 *   clamped to [0.05, 0.96]
 *
 * "Critical zone": riskScore (= round(probabilityDecimal * 100)) >=
 * CRITICAL_RISK_THRESHOLD (75). In practice this is reached only by
 * patients with all three tracked conditions whose last encounter ended
 * within the last 30 days (<= 720h) — i.e. any non-zero recency bonus.
 */
function riskScoreFor(conditionCount: number, recencyHours: number): number {
  const base = 0.1;
  const conditionBonus = 0.18 * conditionCount;
  const recencyBonus = recencyHours <= 72 ? 0.2 : recencyHours <= 168 ? 0.1 : recencyHours <= 720 ? 0.04 : 0;
  const comorbidityBonus = conditionCount === 3 ? 0.08 : 0;
  const probabilityDecimal = Math.min(0.96, Math.max(0.05, base + conditionBonus + recencyBonus + comorbidityBonus));
  return Math.round(probabilityDecimal * 100);
}

export function generatePopulation(): SeedPatient[] {
  const rng = mulberry32(POPULATION_SEED);
  const patients: SeedPatient[] = [];

  for (let i = 0; i < POPULATION_SIZE; i++) {
    const id = `pop-${String(i + 1).padStart(4, '0')}`;
    const gender: SeedPatient['gender'] = i % 2 === 0 ? 'female' : 'male';
    const firstName = pick(rng, gender === 'female' ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE);
    const lastName = pick(rng, LAST_NAMES);
    const birthDate = birthDateFor(rng);
    const raceEthnicity = raceEthnicityFor(rng);
    const recencyHours = pick(rng, RECENCY_HOURS_OPTIONS);

    const mix = CONDITION_MIXES[i % CONDITION_MIXES.length];
    const conditions = mix.map((key) => {
      const lib = CONDITION_LIBRARY[key];
      return { id: `${id}-${key}`, system: lib.system, code: lib.code, display: lib.display };
    });

    const riskScore = riskScoreFor(mix.length, recencyHours);

    patients.push({
      id,
      name: { given: [firstName], family: lastName },
      gender,
      birthDate,
      raceEthnicity,
      conditions,
      encounter: { id: `${id}-encounter`, conditionId: conditions[0].id, dischargedHoursAgo: recencyHours },
      riskScore,
      tasks: [],
    });
  }

  return patients;
}
