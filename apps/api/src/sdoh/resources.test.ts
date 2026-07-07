import { COMMUNITY_RESOURCES, listResourcesByCategory } from './resources';

// S11 A1 — pure-function unit test for the static SDOH resource directory's
// only bit of real logic (the category filter). No FHIR/DB needed — the
// resource list itself is a hardcoded seed, not patient data.
describe('listResourcesByCategory', () => {
  it('returns every resource when no category is given', () => {
    expect(listResourcesByCategory()).toEqual(COMMUNITY_RESOURCES);
  });

  it('returns every resource when category is "all"', () => {
    expect(listResourcesByCategory('all')).toEqual(COMMUNITY_RESOURCES);
  });

  it('filters to only the requested category', () => {
    const result = listResourcesByCategory('transportation');
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.category === 'transportation')).toBe(true);
  });

  it('covers at least 2 resources per category (transportation/food/housing/mental_health/utilities)', () => {
    for (const category of ['transportation', 'food', 'housing', 'mental_health', 'utilities'] as const) {
      expect(listResourcesByCategory(category).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns an empty array for an unknown category', () => {
    expect(listResourcesByCategory('not-a-real-category')).toEqual([]);
  });
});
