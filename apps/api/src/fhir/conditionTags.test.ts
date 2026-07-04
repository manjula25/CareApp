import { shortConditionTag } from './conditionTags';

describe('shortConditionTag', () => {
  it('maps known ICD-10 codes to the reference mockup short tags', () => {
    expect(shortConditionTag('E11.9', 'Type 2 diabetes mellitus without complications')).toBe('Diabetes');
    expect(shortConditionTag('I50.9', 'Heart failure, unspecified')).toBe('CHF');
    expect(shortConditionTag('J44.9', 'Chronic obstructive pulmonary disease, unspecified')).toBe('COPD');
    expect(shortConditionTag('N18.3', 'Chronic kidney disease, stage 3')).toBe('CKD');
    expect(shortConditionTag('I10', 'Essential (primary) hypertension')).toBe('HTN');
  });

  it('falls back to the first two words of the display for unknown codes', () => {
    expect(shortConditionTag('Z00.00', 'Encounter for general adult medical examination')).toBe('Encounter for');
  });
});
