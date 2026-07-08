import { ActionPlannerOutput, CareGapOutput, RiskOutput, SdohOutput } from './agent';

// S12 B.1 — demo-fallback constants returned by the four agents when the
// OpenAI path is unavailable (no `OPENAI_API_KEY` set on the host, or the
// client throws on first use). Shapes conform EXACTLY to this project's
// `AgentEvent` contract in `./agent.ts` (S3 A1), NOT to the lead project's
// `RiskOutput`/`CareGapOutput`/etc. types — the lead types carried extra
// `severity`/`confidence` fields on each flag/gap/barrier that this project's
// `AgentFlag` doesn't expose (intentional per S3's "structured output is
// narrower, citations are stricter" design decision).
//
// Citation behavior: these mock ids almost certainly won't exist in the
// patient's bundle, so `citationValidator.validateCitations` will drop most
// of them on the live path. That's fine — the demo's purpose is "show the
// streaming narration + structured shape", not "demonstrate validated
// citations". The fallback only kicks in when real citation validation
// can't run (no LLM → no real findings → no real citations to validate).

export const MOCK_RISK_OUTPUT: RiskOutput = {
  riskScore: 87,
  riskLevel: 'critical',
  readmissionProbability: 0.73,
  flags: [
    {
      text: 'HbA1c critically elevated at 10.2% — uncontrolled diabetes',
      fhirResourceId: 'Observation/obs-hba1c-4829',
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      text: 'Congestive heart failure with 2 hospitalizations in past 6 months',
      fhirResourceId: 'Condition/cond-chf-1023',
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      text: 'ACE inhibitor not prescribed despite CHF diagnosis — guideline gap',
      fhirResourceId: 'MedicationRequest/medrx-lisinopril-7742',
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      text: 'No PCP visit in 94 days — care continuity gap',
      fhirResourceId: 'Encounter/enc-pcp-3301',
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
  ],
};

export const MOCK_CARE_GAP_OUTPUT: CareGapOutput = {
  gaps: [
    {
      gapType: 'Diabetic retinal eye exam',
      description: 'Diabetic retinal eye exam overdue — last completed >18 months ago',
      urgency: 'high',
      fhirResourceId: 'Observation/obs-eye-exam-2901',
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      gapType: 'Annual influenza vaccination',
      description: 'Annual influenza vaccination not documented for current season',
      urgency: 'medium',
      fhirResourceId: 'Immunization/imm-flu-5512',
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      gapType: 'Post-discharge PCP follow-up',
      description: 'Post-discharge PCP follow-up within 7 days not completed after last hospitalization',
      urgency: 'high',
      fhirResourceId: 'Encounter/enc-discharge-8803',
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
  ],
};

export const MOCK_SDOH_OUTPUT: SdohOutput = {
  barriers: [
    {
      domain: 'transportation',
      finding: 'Patient reports inability to attend appointments due to lack of transportation',
      severity: 'high',
      fhirResourceId: 'QuestionnaireResponse/qr-sdoh-6601',
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      domain: 'food',
      finding: 'Food insecurity identified — patient skips meals due to cost concerns',
      severity: 'high',
      fhirResourceId: 'QuestionnaireResponse/qr-sdoh-6602',
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      domain: 'social_isolation',
      finding: 'Patient lives alone with no regular social contact — high isolation risk',
      severity: 'medium',
      fhirResourceId: 'QuestionnaireResponse/qr-sdoh-6603',
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
  ],
  referralsNeeded: [
    'Non-emergency medical transportation (NEMT) program',
    'Meals on Wheels home delivery program',
    'Community senior center social engagement program',
  ],
};

export const MOCK_ACTION_PLANNER_OUTPUT: ActionPlannerOutput = {
  tasks: [
    {
      title: '48-hour care coordination call',
      description:
        'Schedule urgent outreach call within 48 hours to assess medication adherence, transportation needs, and schedule PCP appointment.',
      priority: 'urgent',
      domain: 'clinical',
      assignTo: 'coordinator',
      dueInDays: 2,
      fhirResources: ['Encounter/enc-pcp-3301'],
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      title: 'Enroll in Meals on Wheels program',
      description:
        'Contact local Meals on Wheels program to enroll patient and arrange daily home food delivery to address food insecurity.',
      priority: 'high',
      domain: 'sdoh',
      assignTo: 'social_worker',
      dueInDays: 5,
      fhirResources: ['QuestionnaireResponse/qr-sdoh-6602'],
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      title: 'Arrange non-emergency medical transportation',
      description:
        'Enroll patient in NEMT program and schedule transport for all upcoming specialist and PCP appointments.',
      priority: 'high',
      domain: 'sdoh',
      assignTo: 'social_worker',
      dueInDays: 7,
      fhirResources: ['QuestionnaireResponse/qr-sdoh-6601'],
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      title: 'Schedule diabetic retinal eye exam',
      description:
        'Refer patient to ophthalmology for overdue annual diabetic retinal exam. Ensure transportation is arranged.',
      priority: 'high',
      domain: 'clinical',
      assignTo: 'coordinator',
      dueInDays: 14,
      fhirResources: ['Observation/obs-eye-exam-2901'],
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
    {
      title: 'Escalate ACE inhibitor prescribing gap to director',
      description:
        'Alert medical director that patient with CHF diagnosis has no ACE inhibitor prescribed — requires physician review and prescription or documented contraindication.',
      priority: 'urgent',
      domain: 'clinical',
      assignTo: 'director',
      dueInDays: 1,
      fhirResources: ['MedicationRequest/medrx-lisinopril-7742'],
      // ponytail: placeholder, real number lands via confidenceScorer.ts in production
      confidence: 0.5,
    },
  ],
};