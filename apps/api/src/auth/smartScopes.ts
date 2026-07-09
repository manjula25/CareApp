import { Role } from './jwt';
import { ResourceDomain } from './scopes';

/**
 * Production SMART scope mapping (Open Question 8 — multi-actor SMART).
 *
 * The POC's `auth/scopes.ts` maps roles to abstract `ResourceDomain` enums
 * (demographic/clinical/sdoh). This file maps roles to concrete SMART scope
 * strings that both the app-tier `smartAuth` middleware and HAPI's
 * `OAuthAuthorizationServletFilter` can enforce. In production, HAPI is
 * rebuilt from `hapi-fhir-jpaserver-starter` with `enforce_scopes: true`,
 * so a social worker's token carrying only `patient/Patient.read` is
 * rejected at the FHIR boundary if they try to read clinical resources.
 *
 * Scope format: `<context>/<ResourceType>.<interaction>` per SMART on FHIR.
 * `system/` = all patients (backend services), `patient/` = single patient
 * (EHR launch context), `user/` = user-scoped.
 */

export type SmartScope = string;

export const ROLE_SMART_SCOPES: Record<Role, SmartScope[]> = {
  director: [
    'system/Patient.read',
    'system/Observation.read',
    'system/Condition.read',
    'system/Task.read',
    'system/Task.write',
    'system/CarePlan.read',
    'system/CarePlan.write',
    'system/ServiceRequest.read',
    'system/ServiceRequest.write',
  ],
  coordinator: [
    'patient/Patient.read',
    'patient/Observation.read',
    'patient/Condition.read',
    'patient/Task.read',
    'patient/Task.write',
    'patient/CarePlan.read',
  ],
  social_worker: [
    'patient/Patient.read',
    'patient/Observation.read',
    'patient/Task.read',
    'patient/Task.write',
  ],
};

export const DOMAIN_SMART_SCOPES: Record<ResourceDomain, SmartScope[]> = {
  demographic: ['patient/Patient.read', 'system/Patient.read'],
  clinical: [
    'patient/Observation.read',
    'patient/Condition.read',
    'system/Observation.read',
    'system/Condition.read',
  ],
  sdoh: ['patient/Observation.read', 'system/Observation.read'],
};

export function getScopesForRole(role: Role): SmartScope[] {
  return ROLE_SMART_SCOPES[role] ?? [];
}

export function hasSmartScope(role: Role, scope: SmartScope): boolean {
  return getScopesForRole(role).includes(scope);
}

export function hasDomainSmartScope(role: Role, domain: ResourceDomain): boolean {
  const roleScopes = new Set(getScopesForRole(role));
  return DOMAIN_SMART_SCOPES[domain].some((s) => roleScopes.has(s));
}

export function scopesForDomain(domain: ResourceDomain): SmartScope[] {
  return DOMAIN_SMART_SCOPES[domain];
}
