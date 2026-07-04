const ICD10_SHORT_TAG: Record<string, string> = {
  'E11.9': 'Diabetes',
  'I50.9': 'CHF',
  'F33.1': 'Depression',
  'J44.9': 'COPD',
  'N18.3': 'CKD',
  'S72.001A': 'Hip fracture',
  I10: 'HTN',
};

/** Short list-row tag matching the reference mockup's `.ptag` chips (reference-materials/caresync-ai.html). */
export function shortConditionTag(code: string | undefined, display: string): string {
  if (code && ICD10_SHORT_TAG[code]) return ICD10_SHORT_TAG[code];
  return display.split(' ').slice(0, 2).join(' ');
}
