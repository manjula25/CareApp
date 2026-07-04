import {
  validateCitations,
  validateCitationList,
  redactUnvalidatedCitations,
  createNarrationBuffer,
} from './citationValidator';

describe('validateCitations (Seam 2 — GD11 citation enforcement)', () => {
  const validIds = new Set(['Condition/maria-chen-chf', 'Observation/maria-chen-hba1c']);

  it('keeps an in-bundle citation and drops a fabricated one', () => {
    const flags = [
      { text: 'CHF diagnosis', fhirResourceId: 'Condition/maria-chen-chf' },
      { text: 'hallucinated finding', fhirResourceId: 'Observation/does-not-exist' },
    ];

    const { valid, dropped } = validateCitations(flags, validIds);

    expect(valid).toEqual([{ text: 'CHF diagnosis', fhirResourceId: 'Condition/maria-chen-chf' }]);
    expect(dropped).toEqual([{ text: 'hallucinated finding', fhirResourceId: 'Observation/does-not-exist' }]);
  });

  it('returns empty valid and dropped for empty flags', () => {
    expect(validateCitations([], validIds)).toEqual({ valid: [], dropped: [] });
  });

  it('resolves a whitespace-padded id (trims before matching)', () => {
    const flags = [{ text: 'HbA1c elevated', fhirResourceId: '  Observation/maria-chen-hba1c  ' }];

    const { valid, dropped } = validateCitations(flags, validIds);

    expect(valid).toEqual([{ text: 'HbA1c elevated', fhirResourceId: 'Observation/maria-chen-hba1c' }]);
    expect(dropped).toEqual([]);
  });

  it('does not case-fold FHIR ids (they are case-sensitive)', () => {
    const flags = [{ text: 'wrong case', fhirResourceId: 'condition/maria-chen-chf' }];

    const { valid, dropped } = validateCitations(flags, validIds);

    expect(valid).toEqual([]);
    expect(dropped).toEqual([{ text: 'wrong case', fhirResourceId: 'condition/maria-chen-chf' }]);
  });
});

describe('validateCitationList (GD11 — id-list items, all-or-nothing per item)', () => {
  const validIds = new Set(['Condition/maria-chen-chf', 'Observation/maria-chen-hba1c']);

  // An Action-Planner-shaped item: cites an ARRAY of FHIR ids.
  interface Task {
    title: string;
    fhirResources: string[];
  }
  const getIds = (t: Task) => t.fhirResources;
  const withIds = (t: Task, ids: string[]): Task => ({ ...t, fhirResources: ids });

  it('keeps an item with at least one valid id, narrowing its id list to only the valid ids', () => {
    const items: Task[] = [
      { title: 'Schedule cardiology follow-up', fhirResources: ['Condition/maria-chen-chf', 'Observation/does-not-exist'] },
    ];

    const { valid, dropped } = validateCitationList(items, getIds, withIds, validIds);

    expect(valid).toEqual([{ title: 'Schedule cardiology follow-up', fhirResources: ['Condition/maria-chen-chf'] }]);
    expect(dropped).toEqual([]);
  });

  it('drops an item whose cited ids all miss the bundle', () => {
    const items: Task[] = [
      { title: 'Bogus task', fhirResources: ['Observation/does-not-exist', 'Condition/also-fake'] },
    ];

    const { valid, dropped } = validateCitationList(items, getIds, withIds, validIds);

    expect(valid).toEqual([]);
    expect(dropped).toEqual([{ title: 'Bogus task', fhirResources: ['Observation/does-not-exist', 'Condition/also-fake'] }]);
  });

  it('trims each id before matching but keeps FHIR ids case-sensitive', () => {
    const items: Task[] = [
      { title: 'Mixed', fhirResources: ['  Observation/maria-chen-hba1c  ', 'condition/maria-chen-chf'] },
    ];

    const { valid, dropped } = validateCitationList(items, getIds, withIds, validIds);

    expect(valid).toEqual([{ title: 'Mixed', fhirResources: ['Observation/maria-chen-hba1c'] }]);
    expect(dropped).toEqual([]);
  });
});

describe('redactUnvalidatedCitations (GD11 — narration text is not exempt from validation)', () => {
  const validIds = new Set(['Condition/maria-chen-chf', 'Observation/maria-chen-hba1c']);

  it('leaves a citation to an in-bundle resource untouched', () => {
    const text = 'Given the CHF diagnosis (Condition/maria-chen-chf), risk is elevated.';
    expect(redactUnvalidatedCitations(text, validIds)).toBe(text);
  });

  it('redacts a citation to a resource absent from the bundle', () => {
    const text = 'Notably, Observation/does-not-exist supports this finding.';
    expect(redactUnvalidatedCitations(text, validIds)).toBe('Notably, [unverified citation removed] supports this finding.');
  });

  it('leaves plain narration with no ResourceType/id pattern untouched', () => {
    const text = 'This patient has a high readmission risk given recent labs.';
    expect(redactUnvalidatedCitations(text, validIds)).toBe(text);
  });

  it('redacts multiple fabricated citations independently, keeping valid ones', () => {
    const text = 'See Condition/maria-chen-chf and MedicationRequest/fake-one and also Task/fake-two.';
    expect(redactUnvalidatedCitations(text, validIds)).toBe(
      'See Condition/maria-chen-chf and [unverified citation removed] and also [unverified citation removed].'
    );
  });
});

describe('createNarrationBuffer (GD11 — streamed narration is buffered and redacted before emit)', () => {
  const validIds = new Set(['Condition/maria-chen-chf']);

  it('buffers short deltas and only redacts/emits once the lookahead window fills', () => {
    const buffer = createNarrationBuffer(validIds, 10);

    expect(buffer.push('short')).toBe('');
    expect(buffer.flush()).toBe('short');
  });

  it('emits safe text once the pending buffer exceeds the lookahead, holding back the tail', () => {
    const buffer = createNarrationBuffer(validIds, 5);

    const emitted = buffer.push('hello world');

    expect(emitted).toBe('hello ');
    expect(buffer.flush()).toBe('world');
  });

  it('catches a fabricated citation even when its characters arrive split across two deltas', () => {
    const buffer = createNarrationBuffer(validIds, 40);

    let emitted = buffer.push('Notably, Observation/does-not-e');
    emitted += buffer.push('xist supports this finding, plus more reasoning after it.');
    emitted += buffer.flush();

    expect(emitted).not.toContain('does-not-exist');
    expect(emitted).toBe('Notably, [unverified citation removed] supports this finding, plus more reasoning after it.');
  });

  it('passes an in-bundle citation through unredacted end to end', () => {
    const buffer = createNarrationBuffer(validIds, 20);

    let emitted = buffer.push('CHF diagnosis (Condition/maria-chen-chf) drives this.');
    emitted += buffer.flush();

    expect(emitted).toBe('CHF diagnosis (Condition/maria-chen-chf) drives this.');
  });
});
