import { ensureTaskSubscription } from './subscription';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';
const CALLBACK_URL = 'http://host.docker.internal:4000/api/fhir/subscription-hook';

// Exercised against the real disposable HAPI container (Seam 1 reference
// pattern). Cleans up before AND after each test: a crashed prior run could
// leave a Subscription behind, and starting from a known-clean state is what
// makes "does not create a second one" actually prove idempotency rather
// than happening to find someone else's leftover row.
async function deleteSubscriptionsForCallback(): Promise<void> {
  const res = await fetch(`${FHIR_BASE_URL}/Subscription?_count=50`, { headers: { 'Cache-Control': 'no-cache' } });
  const bundle = (await res.json()) as { entry?: { resource: any }[] };
  for (const entry of bundle.entry ?? []) {
    if (entry.resource?.channel?.endpoint === CALLBACK_URL) {
      await fetch(`${FHIR_BASE_URL}/Subscription/${entry.resource.id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  }
}

describe('ensureTaskSubscription', () => {
  beforeEach(deleteSubscriptionsForCallback);
  afterEach(deleteSubscriptionsForCallback);

  it('creates a Subscription with the expected criteria, channel type, and endpoint', async () => {
    const result = await ensureTaskSubscription(FHIR_BASE_URL, CALLBACK_URL);
    expect(result.created).toBe(true);

    const fetched = (await (await fetch(`${FHIR_BASE_URL}/Subscription/${result.id}`)).json()) as any;
    expect(fetched.resourceType).toBe('Subscription');
    expect(fetched.status).toBe('requested');
    expect(fetched.criteria).toBe('Task?');
    expect(fetched.channel).toMatchObject({ type: 'rest-hook', endpoint: CALLBACK_URL, payload: 'application/fhir+json' });
  }, 15000);

  it('does not create a second Subscription when called again', async () => {
    const first = await ensureTaskSubscription(FHIR_BASE_URL, CALLBACK_URL);
    const second = await ensureTaskSubscription(FHIR_BASE_URL, CALLBACK_URL);

    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    const res = await fetch(`${FHIR_BASE_URL}/Subscription?_count=50`, { headers: { 'Cache-Control': 'no-cache' } });
    const bundle = (await res.json()) as { entry?: { resource: any }[] };
    const matching = (bundle.entry ?? []).filter((e) => e.resource?.channel?.endpoint === CALLBACK_URL);
    expect(matching).toHaveLength(1);
  }, 15000);
});
