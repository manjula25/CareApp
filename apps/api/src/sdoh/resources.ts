// S11 A1 — SDOH community resource directory (M05). This is a small static
// seed list, deliberately NOT FHIR-backed: community organizations (transit
// programs, food banks, housing navigators, etc.) are reference data about
// the outside world, not patient data, so there is no FHIR resource type this
// belongs in and no reason to invent one for a POC. Referring a patient to
// one of these resources is what creates the real FHIR write (see
// `FhirReadService.createServiceRequest` in `fhir/client.ts`).
export interface CommunityResource {
  id: string;
  name: string;
  category: 'transportation' | 'food' | 'housing' | 'mental_health' | 'utilities';
  description: string;
  coverage: string;
  phone?: string;
}

export const COMMUNITY_RESOURCES: CommunityResource[] = [
  {
    id: 'metro-transit-assistance',
    name: 'Metro Transit Assistance Program',
    category: 'transportation',
    description: 'Discounted fixed-route bus and rail passes for Medicaid-enrolled patients.',
    coverage: 'Free for Medicaid',
    phone: '555-0101',
  },
  {
    id: 'cityride-medical-transport',
    name: 'CityRide Medical Transport',
    category: 'transportation',
    description: 'Door-to-door non-emergency medical transport, 24/7 dispatch.',
    coverage: '$0 copay with prior auth',
    phone: '555-0102',
  },
  {
    id: 'community-health-van',
    name: 'Community Health Van Service',
    category: 'transportation',
    description: 'Volunteer-driven shuttle to clinic appointments, no insurance required.',
    coverage: 'Free · No insurance required',
    phone: '555-0103',
  },
  {
    id: 'volunteer-driver-network',
    name: 'Volunteer Driver Network',
    category: 'transportation',
    description: 'Neighbor volunteer drivers for non-urgent appointments, booked in advance.',
    coverage: 'Free · 48h advance notice',
    phone: '555-0104',
  },
  {
    id: 'metro-food-bank',
    name: 'Metro Regional Food Bank',
    category: 'food',
    description: 'Weekly grocery boxes and fresh produce distribution, no eligibility screening.',
    coverage: 'Free · Walk-in',
    phone: '555-0201',
  },
  {
    id: 'community-meals-on-wheels',
    name: 'Community Meals on Wheels',
    category: 'food',
    description: 'Home-delivered meals for homebound patients with chronic conditions.',
    coverage: 'Sliding scale',
    phone: '555-0202',
  },
  {
    id: 'housing-navigator-program',
    name: 'Regional Housing Navigator Program',
    category: 'housing',
    description: 'Case-managed placement assistance for patients facing eviction or homelessness.',
    coverage: 'Free',
    phone: '555-0301',
  },
  {
    id: 'stable-tenancy-fund',
    name: 'Stable Tenancy Emergency Rental Fund',
    category: 'housing',
    description: 'One-time emergency rental assistance grants to prevent eviction.',
    coverage: 'Grant-based, income qualified',
    phone: '555-0302',
  },
  {
    id: 'community-mental-health-clinic',
    name: 'Community Mental Health Clinic',
    category: 'mental_health',
    description: 'Sliding-scale outpatient counseling and psychiatric medication management.',
    coverage: 'Sliding scale · Medicaid accepted',
    phone: '555-0401',
  },
  {
    id: 'crisis-support-line',
    name: '24/7 Crisis Support & Warmline',
    category: 'mental_health',
    description: 'Peer-staffed crisis and warmline support, same-day referral to local clinicians.',
    coverage: 'Free',
    phone: '555-0402',
  },
  {
    id: 'utility-assistance-fund',
    name: 'Regional Utility Assistance Fund',
    category: 'utilities',
    description: 'One-time grants toward past-due electric, gas, or water bills.',
    coverage: 'Grant-based, income qualified',
    phone: '555-0501',
  },
  {
    id: 'weatherization-assistance',
    name: 'Home Weatherization Assistance Program',
    category: 'utilities',
    description: 'Free home weatherization to reduce heating/cooling costs for qualifying households.',
    coverage: 'Free, income qualified',
    phone: '555-0502',
  },
];

/**
 * Pure filter over the static `COMMUNITY_RESOURCES` seed list — no category
 * (or `'all'`) returns every resource; any other string filters to an exact
 * `category` match (an unrecognized category returns an empty list rather
 * than throwing, since this backs a user-typed query param).
 */
export function listResourcesByCategory(category?: string): CommunityResource[] {
  if (!category || category === 'all') return COMMUNITY_RESOURCES;
  return COMMUNITY_RESOURCES.filter((r) => r.category === category);
}
