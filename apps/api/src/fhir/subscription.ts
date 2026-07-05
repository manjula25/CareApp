// S6 A2 — idempotent HAPI Subscription bootstrap. Ensures ONE `Subscription`
// resource exists on HAPI: `status: 'requested'` (HAPI itself flips this to
// 'active' once it accepts the rest-hook channel — this module never sets
// 'active' directly), criteria `'Task'` (any Task create/update), channel
// `rest-hook` at `callbackUrl` with `payload: 'application/fhir+json'` so
// HAPI's notification carries the full changed Task resource — confirmed
// against the local instance (7.2.0): a channel with NO payload field fires
// with an empty body and no header identifying which resource changed, so
// the webhook (routes/events.ts) would have nothing to act on without this;
// with `payload` set, the POST body IS the Task, no re-read needed.
//
// No standard FHIR search param filters Subscription by `criteria` on this
// HAPI version, so idempotency is done client-side: list existing
// Subscriptions and look for one whose `criteria` + `channel.endpoint`
// already match, rather than searching for it server-side.

export interface EnsureSubscriptionResult {
  id: string;
  created: boolean;
}

// HAPI requires criteria in "{ResourceType}?[params]" form even with no
// params (confirmed against the local instance — a bare "Task" is rejected
// with HAPI-0014); "Task?" matches every Task create/update.
const TASK_SUBSCRIPTION_CRITERIA = 'Task?';
const SUBSCRIPTION_SEARCH_COUNT = 50;

interface FhirSubscription {
  id: string;
  criteria?: string;
  channel?: { type?: string; endpoint?: string };
}

// `Cache-Control: no-cache` is load-bearing here, not decorative: HAPI's JPA
// server reuses a prior search's result set (by URL) for a window after it
// runs, so a bare GET right after creating a Subscription can return the
// *pre-creation* bundle — confirmed against the local instance, where a
// just-created Subscription was invisible for 4+ seconds without this header
// but present immediately with it. Without this, `ensureTaskSubscription`
// would create a duplicate on every call that lands inside that cache
// window (exactly what its own idempotency test exercises).
async function findExistingSubscription(fhirBaseUrl: string, callbackUrl: string): Promise<FhirSubscription | undefined> {
  const res = await fetch(`${fhirBaseUrl}/Subscription?_count=${SUBSCRIPTION_SEARCH_COUNT}`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!res.ok) {
    throw new Error(`Subscription search failed: ${res.status}`);
  }
  const bundle = (await res.json()) as { entry?: { resource: FhirSubscription }[] };
  return (bundle.entry ?? [])
    .map((e) => e.resource)
    .find((sub) => sub.criteria === TASK_SUBSCRIPTION_CRITERIA && sub.channel?.endpoint === callbackUrl);
}

export async function ensureTaskSubscription(fhirBaseUrl: string, callbackUrl: string): Promise<EnsureSubscriptionResult> {
  const existing = await findExistingSubscription(fhirBaseUrl, callbackUrl);
  if (existing) {
    return { id: existing.id, created: false };
  }

  const body = {
    resourceType: 'Subscription',
    status: 'requested',
    reason: 'CareSync S6 — relay Task assignment changes to connected clients',
    criteria: TASK_SUBSCRIPTION_CRITERIA,
    channel: {
      type: 'rest-hook',
      endpoint: callbackUrl,
      payload: 'application/fhir+json',
    },
  };

  const res = await fetch(`${fhirBaseUrl}/Subscription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/fhir+json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Subscription create failed: ${res.status}`);
  }
  const created = (await res.json()) as { id: string };
  return { id: created.id, created: true };
}
