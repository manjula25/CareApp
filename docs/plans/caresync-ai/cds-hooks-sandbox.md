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

## Steps (confirmed working live, 2026-07-07)

1. **Start the local stack.** From `apps/api`: `PORT=4177 npx tsx src/index.ts` (or `npm run dev` for
   the full stack + HAPI via `docker compose up` per the S1 setup, if you also want the web UI).
   Confirm the analysis cache is warm for the demo patient: log in as a Coordinator, open the patient,
   click **Run Analysis** once — or check directly: `sqlite3 apps/api/data/caresync.sqlite "select
   patient_id from analysis_cache"`.

2. **Expose the API publicly.** The sandbox needs an HTTPS URL it can reach from the internet:
   ```
   ngrok http 4177
   ```
   Note the `https://<random>.ngrok-free.app` URL ngrok prints (it changes every restart on a free
   plan). Sanity-check it's live: `curl -H "ngrok-skip-browser-warning: true"
   https://<random>.ngrok-free.app/cds-services`.

3. **Register the service in the sandbox.** Open https://sandbox.cds-hooks.org/. The top-right gear
   icon's dropdown menu (not the "Select a Service" box itself — that only searches an existing list)
   has **"Add CDS Services"**. Paste the discovery URL there and Save:
   ```
   https://<random>.ngrok-free.app/cds-services
   ```
   The sandbox `GET`s that URL, and `caresync-patient-view` becomes selectable in "Select a Service".

4. **Fire the hook.** Selecting `caresync-patient-view` in the "Select a Service" dropdown fires the
   hook immediately with whatever patient is currently in context — the sandbox's own "Request"/
   "Response" accordions show the exact payload sent and the exact JSON returned.

## Known limitation: the sandbox's patient picker is tied to its own reference FHIR server

The gear menu's **"Change Patient"** dialog only offers patients that exist on the sandbox's
**"Current FHIR server"** (defaults to `https://launch.smarthealthit.org/v/r2/fhir`) — it's a
type-ahead search against *that* server's real patient roster, not a free-text field, and it has no
overlap with our local `analysis_cache` patient ids (`maria-chen`, etc.). So firing the hook against
whichever `launch.smarthealthit.org` patient the sandbox currently has selected will honestly return
`cards: []` (a correct response — that patient just isn't in our cache), even though the exact same
request against `maria-chen` returns real populated cards locally (proven via `curl` — see
`verification-s10.md`). Getting a *populated* card to render inside the public sandbox's own UI would
require also pointing its "Current FHIR server" at a tunneled instance of our own HAPI — out of scope
for this smoke test.

## Honest-staging note (GD2)

This is **target-environment evidence** only for the tunnel-and-sandbox round trip itself
(routing, CORS, JSON shape) — the underlying findings are whatever was cached from a prior
local/live analysis run, not re-verified against HAPI at hook-fire time. If the public
sandbox can't reach the tunnel during a live demo (network/tunnel flake), fall back to a
local smoke test — `curl` the same discovery + service URLs directly against `localhost:4000`
— and record that as **local mock/packaged evidence** instead, per `CLAUDE.md`'s evidence
boundaries.
