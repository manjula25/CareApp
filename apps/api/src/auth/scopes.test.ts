import { hasScope } from './scopes';

describe('hasScope', () => {
  it('grants director every domain', () => {
    expect(hasScope('director', 'demographic')).toBe(true);
    expect(hasScope('director', 'clinical')).toBe(true);
    expect(hasScope('director', 'sdoh')).toBe(true);
  });

  it('grants coordinator demographic, clinical, and sdoh', () => {
    expect(hasScope('coordinator', 'demographic')).toBe(true);
    expect(hasScope('coordinator', 'clinical')).toBe(true);
    expect(hasScope('coordinator', 'sdoh')).toBe(true);
  });

  it('denies social_worker access to clinical data outside sdoh', () => {
    expect(hasScope('social_worker', 'demographic')).toBe(true);
    expect(hasScope('social_worker', 'sdoh')).toBe(true);
    expect(hasScope('social_worker', 'clinical')).toBe(false);
  });
});
