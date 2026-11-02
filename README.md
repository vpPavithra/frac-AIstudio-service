# frac-studio-service

Backend for FRAC Studio (FRAC Creator, FRAC Reviewer, My FRACs). The UI lives in `sunbird-cb-orgportal`
at `app/frac-studio`, and calls this service through `sunbird-cb-uiproxy` at `/apis/protected/v8/fracStudio/*`.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run

```bash
cp .env.example .env      # fill Postgres + ANTHROPIC_API_KEY
npm install
psql "$DATABASE_URL" -f migrations/001_init.sql
npm run dev               # http://localhost:3005/health
```

## Test

```bash
npm test                  # unit tests (src/**/*.test.ts) + acceptance (test/*.test.ts)
npm run test:coverage
```

`test/sample.test.ts` runs three synthetic workbooks (GNM-, ANM- and Staff-Nurse-style, built in
`test/support/sample-workbooks.ts`) with every defect planted at a known count. `npm run fixtures:sample`
writes them to `test/fixtures/sample/` for manual uploads. They are test data, not clinical content.

The acceptance tests in `test/acceptance.test.ts` reproduce spec section 6.6 and are skipped until the real
dictionaries are copied into `test/fixtures/` (they are gitignored):

- `GNM COMPETENCY DICTIONARY 9 June 2025.xlsx`
- `ANM competencies 6aug2026.xlsx`
- `Staff Nurse competencies - India v0.1.xlsx`

## Extending the outdated-terms list

Edit `config/outdated.json` (or point `OUTDATED_CONFIG_PATH` at another copy). No code change or deploy is
needed; it is read when a review runs.
