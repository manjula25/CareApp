# S10 B1 — Pointing the public CDS Hooks sandbox at CareSync AI

**Sandbox:** https://sandbox.cds-hooks.org/ — a public, browser-hosted CDS Hooks client. It
runs in the visitor's browser, not on our infrastructure, so it can only reach a
`GET /cds-services` discovery URL and `POST /cds-services/{id}` service URL that are
**publicly resolvable over HTTPS** — it cannot reach `localhost` directly.

## Prerequisites

- CORS is already fully open for this (`apps/api/src/index.ts`'s `app.use(cors())`, no
  options) — no CORS config work needed (see the S10 plan-review note in
  `implementation-plan.md`).
- Neither CDS Hooks route is behind `requireAuth` (`apps/api/src/routes/cdsHooks.ts`) — the
  sandbox has no CareSync session token.
- The patient-view service is **cache-only** (S10 A2): it never triggers a live analysis
  run. For the sandbox to see real cards (not an empty `cards: []`), the patient in
  context must already have a row in `analysis_cache` — i.e. someone has clicked
  **Run Analysis** for that patient in the CareSync AI web app at least once before the
  sandbox demo.

## Steps

1. **Start the local stack.** From the repo root: `npm run dev` (starts both
   `apps/api` on `PORT` — default `4000` — and `apps/web`), with HAPI FHIR running via
   `docker compose up` per the S1 setup. Confirm the analysis cache is warm for the demo
   patient: log in as a Coordinator, open the patient, click **Run Analysis** once.

2. **Expose the API publicly.** The sandbox needs an HTTPS URL it can reach from the
   internet. Use a tunnel, e.g.:
   ```
   ngrok http 4000
   ```
   Note the `https://<random>.ngrok-free.app` URL ngrok prints — that's your public base
   URL for this session (it changes every time you restart the tunnel on a free plan).

3. **Register the service in the sandbox.** Open https://sandbox.cds-hooks.org/, add a
   new CDS Service by its **discovery URL**:
   ```
   https://<random>.ngrok-free.app/cds-services
   ```
   The sandbox will `GET` that URL and list **"CareSync AI Patient-View Findings"**
   (`hook: patient-view`, `id: caresync-patient-view`).

4. **Fire the hook.** Select the `patient-view` hook and set the patient context to the
   demo patient's FHIR `Patient` id (the same id `analysis_cache` is keyed on — the
   CareSync patient id, not a display name). The sandbox `POST`s to
   `https://<random>.ngrok-free.app/cds-services/caresync-patient-view` with
   `{ context: { patientId: "<id>" } }`; the response's `cards` should show the risk,
   care-gap, and SDOH findings from that patient's cached analysis, each with an
   `(FHIR: ResourceType/id)` citation in its `detail`.

## Honest-staging note (GD2)

This is **target-environment evidence** only for the tunnel-and-sandbox round trip itself
(routing, CORS, JSON shape) — the underlying findings are whatever was cached from a prior
local/live analysis run, not re-verified against HAPI at hook-fire time. If the public
sandbox can't reach the tunnel during a live demo (network/tunnel flake), fall back to a
local smoke test — `curl` the same discovery + service URLs directly against `localhost:4000`
— and record that as **local mock/packaged evidence** instead, per `CLAUDE.md`'s evidence
boundaries.
