# frac-studio-service

Backend for FRAC Studio (FRAC Creator, FRAC Reviewer, My FRACs). The UI lives in `sunbird-cb-orgportal`
at `app/frac-studio`, and calls this service through `sunbird-cb-uiproxy` at `/apis/protected/v8/fracStudio/*`.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run

```bash
cp .env.example .env      # fill the POSTGRES_* settings
npm install
npm run migrate           # applies migrations/*.sql not yet recorded in schema_migrations
npm run dev               # http://localhost:3005/health
```

Without Postgres: `FRAC_STUDIO_STORE=memory npm run dev` (data is lost on restart). For orgportal local
development, run it on another port (`PORT=3010`) and add the `/apis/protected/v8/fracStudio` rule to
orgportal's `proxy/localhost.proxy.json`.

Settings live in `config/service.json` (models, rates, limits, timeouts, CORS); the environment overrides
any of them, and `.env` holds secrets and per-deployment values only. After editing config, run
`npm run config:check`. `npm run check` runs typecheck, lint, config check and tests. New here? Read
`ONBOARDING.md` and `CLAUDE.md`.

## AI provider: Claude with a key, the mock without

The AI steps call **Claude** (`src/providers/text/claude.ts`) when `ANTHROPIC_API_KEY` is set, and the
**mock** (`src/mocks/`, editable sample data, no cost) when it is not. Nothing else changes between them.

- **Where the key goes:** `ANTHROPIC_API_KEY` in the service's `.env` locally; the deployment's secret
  store on a server. Never `config/service.json` (committed; startup refuses secrets there).
- Startup logs `"ai":"claude"` or `"ai":"mock"`; `GET /v1/info` returns the same.
- Run with sample data preloaded: `FRAC_STUDIO_STORE=memory MOCK_SEED=true PORT=3010 npm run dev`.

What switching affects, how to edit the sample data, and how to delete the mocks: [src/mocks/README.md](src/mocks/README.md).

## Deploy

Same pipeline as playlist-service (`Jenkinsfile`): `Dockerfile.build` compiles and zips `dist/`, `config/` and
`migrations/`; `build.sh` builds the runtime image from `Dockerfile` (Node 20 alpine, port 3005, runs as `node`).

- **Migrations:** run `node migrate.js` in the image once per deploy (a job or init container), or set
  `MIGRATE_ON_START=true`. Each file runs once, in its own transaction, under an advisory lock, so several
  replicas starting together are safe.
- **Network:** the service trusts the `x-aastrika-creator` header, so expose it only inside the cluster. The
  uiproxy reaches it through `FRAC_STUDIO_API_BASE` (default `${KONG_API_BASE}/frac-studio`, so a Kong route
  `/frac-studio` → this service, or point the variable straight at the service).
- **Shutdown:** on SIGTERM it stops taking requests and lets running jobs finish before exiting. Give the pod a
  termination grace period longer than the longest job.

## Test

```bash
npm test                  # unit tests (src/**/*.test.ts) + acceptance (test/*.test.ts)
npm run test:coverage
```

`test/pg.test.ts` runs the real migration and the API flows through the Postgres repositories on pg-mem (an
in-memory Postgres), so no database server is needed. It is close to Postgres but not identical; run
`npm run migrate` against a real database before the first deploy.

`test/sample.test.ts` runs three synthetic workbooks (GNM-, ANM- and Staff-Nurse-style, built in
`test/support/sample-workbooks.ts`) with every defect planted at a known count. `npm run fixtures:sample`
writes them to `test/fixtures/sample/` for manual uploads. They are test data, not clinical content.

The acceptance tests in `test/acceptance.test.ts` reproduce spec section 6.6 and are skipped until the real
dictionaries are copied into `test/fixtures/` (they are gitignored):

- `GNM COMPETENCY DICTIONARY 9 June 2025.xlsx`
- `ANM competencies 6aug2026.xlsx`
- `Staff Nurse competencies - India v0.1.xlsx`

## Extending the review rules

The review engine is r3 (`docs/spec/FRAC_Reviewer_rules_r3.md`). Clinical reviewers edit two files; no
code change or deploy is needed, both are read when a review runs:

| File | Holds | Override |
|---|---|---|
| `config/outdated.json` | Outdated laws and programme names (§4.5), with `onlyIfAbsent` / `frontlineOnly` conditions | `OUTDATED_CONFIG_PATH` |
| `config/review-rules.json` | Acts beyond scope per cadre (§4.4), ladder-shift rules (§4.3), core job areas per cadre (§5) | `REVIEW_RULES_CONFIG_PATH` |

The review fingerprint includes both files, so a stored review is never reused after a rule changes.
What is built against the spec and rules, and what is still open: `docs/spec/R3_GAP_ANALYSIS.md`.
