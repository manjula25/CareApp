# CareSync AI

A POC healthcare sync app built with an Express + SQLite backend and a Vite + React frontend, communicating with a HAPI FHIR R4 server.

## Prerequisites

- Node.js (v18+)
- Docker (for the HAPI FHIR server — required for any patient/task data to appear)

## First-time setup (run in order)

```bash
# 1. Install deps
npm install

# 2. Configure env (optional overrides — defaults work out of the box)
cp apps/api/.env.example apps/api/.env
# set OPENAI_API_KEY in apps/api/.env if you want live Risk Agent analysis (S2+);
# leaving it blank disables live analysis but everything else still works.

# 3. Start the FHIR server
npm run fhir:up             # docker compose up -d hapi-fhir

# 4. Create the SQLite schema (also runs automatically on first API start —
#    explicit step is here for clarity / CI)
npm run migrate             # apps/api/data/caresync.sqlite

# 5. Seed demo user accounts (director / coordinator / social worker)
npm run seed

# 6. Import demo FHIR data (patients, conditions, tasks, ~500-patient
#    population cohort) into the HAPI container — waits for HAPI to be ready
npm run fhir:import

# 7. Run the app
npm run dev
```

Steps 3–6 only need to be redone if you tear down the `hapi-fhir` Docker volume or want fresh data
(see **Resetting local data** below). SQLite persists on disk (`apps/api/data/caresync.sqlite`), so
step 4/5 are one-time unless you delete that file.

### Demo login credentials

Seeded by step 5 (`npm run seed`), password is the same for all three:

| Role           | Email                          | Password     |
|----------------|---------------------------------|---------------|
| Director       | `director@caresync.demo`        | `Demo1234!`   |
| Coordinator    | `coordinator@caresync.demo`     | `Demo1234!`   |
| Social Worker  | `socialworker@caresync.demo`    | `Demo1234!`   |

## Running the app

### Both frontend and backend together

```bash
npm run dev
```

### Separately

**Backend (Express API)** — runs on `http://localhost:4000`

```bash
npm run dev --workspace apps/api
```

**Frontend (Vite + React)** — runs on `http://localhost:5173`

```bash
npm run dev --workspace apps/web
```

### HAPI FHIR server

The API expects a FHIR server at `http://localhost:8080/fhir` (override with `FHIR_BASE_URL`).
Started via `npm run fhir:up` in first-time setup above. Real-time task-assignment sync (S6+) relies
on HAPI's rest-hook Subscriptions POSTing back to the API — `docker-compose.yml` already turns this
on (`hapi.fhir.subscription.resthook_enabled`), and the callback URL defaults to
`http://host.docker.internal:4000/...` (reachable from *inside* the container). Override with
`SUBSCRIPTION_CALLBACK_URL` in `apps/api/.env` if your Docker setup doesn't support
`host.docker.internal`.

### Resetting local data

If HAPI data looks stale or duplicated (e.g. after repeated manual testing against the same
container), wipe and re-import:

```bash
docker compose down -v && docker compose up -d hapi-fhir
npm run fhir:import
```

To reset the SQLite side (users, audit log, analysis cache) too, stop the API and delete
`apps/api/data/caresync.sqlite`, then re-run `npm run migrate && npm run seed`.

## Ports

| Service    | URL                          |
|------------|------------------------------|
| Frontend   | `http://localhost:5173`      |
| Backend    | `http://localhost:4000`      |
| HAPI FHIR  | `http://localhost:8080/fhir` |

## Other commands

| Command              | Description                          |
|----------------------|--------------------------------------|
| `npm run build`      | Build both api and web               |
| `npm run lint`       | Lint both api and web                |
| `npm run test:api`   | Run backend tests                    |
| `npm run test:web`   | Run frontend tests                   |
| `npm run test:e2e`   | Run Playwright E2E tests             |
