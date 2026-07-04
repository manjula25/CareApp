import { Role } from './jwt';

export type ResourceDomain = 'demographic' | 'clinical' | 'sdoh';

const ROLE_SCOPES: Record<Role, ResourceDomain[]> = {
  director: ['demographic', 'clinical', 'sdoh'],
  coordinator: ['demographic', 'clinical', 'sdoh'],
  social_worker: ['demographic', 'sdoh'],
};

export function hasScope(role: Role, domain: ResourceDomain): boolean {
  return ROLE_SCOPES[role].includes(domain);
}
