# tools/: not part of the running service

Command-line tools you run by hand, or that CI runs. They import from `src/` (models, repositories, config);
`src/` never imports them, and they are not compiled into `dist/` or shipped in the image. They run with
ts-node through the npm scripts. `npm run typecheck` checks them with `tsconfig.tools.json`, and `npm run lint`
and `npm test` cover them.

| Folder | Command | What it does |
| --- | --- | --- |
| `reports/` | `npm run ai:report`, `ai:report:daily`, `ai:report:run` | AI response reports from the `ai_calls`, `jobs`, `reviews` and `server_runs` tables, into `reports/` |
| `reports/` | `npm run review:report -- <id>` | Review analysis for one upload or one FRAC's expert checks, into `reports/reviews/` |
| `ops/` | `npm run config:check` | Validates `config/service.json` and the provider profiles (runs in CI) |
| `ops/` | `npm run ai:check` | One tiny real call per tier to the `AI_PROVIDER` profile, to prove the key |
| `fixtures/` | `npm run fixtures:sample` | Writes the sample workbooks used by the tests |

In `reports/`, `ai-report.ts` and `review-report.ts` are pure Markdown builders with unit tests; `run-*.ts` are
the command-line entry points that read Postgres and write the files. How the data they read is produced:
[docs/CODE_FLOW.md](../docs/CODE_FLOW.md) section 8.
