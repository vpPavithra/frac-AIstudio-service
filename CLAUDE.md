# Working in this repo

frac-studio-service is the backend for FRAC Studio (FRAC Creator, Reviewer, My FRACs). It follows the
conventions of its sibling, [aastrika-ai-service](https://github.com/Sphere/aastrika-ai-service). Where
this file is silent, do what that repo does.

## Git

**Never add a `Co-Authored-By: Claude` trailer.** End the commit message at the body.

**Never commit without being asked.** Make the change, say what changed and which files, then stop.

**Deploy once, after complete testing.** No deploy, staging rollout or DevOps request until the
pre-deploy checklist in orgportal's `docs/frac-studio/FRAC_STUDIO_BUILD_TRACKER.html` passes.

Commits: Conventional Commits (`feat:`, `fix:`, `chore:`), on a feature branch.

## Changes

1. Tests green before a change starts, green before it is done.
2. Move code verbatim in one commit; improve it in the next. Never both.
3. If a step cannot be proven safe by a test, it does not ship.
4. Paid API calls only when required. Tests never call a model.

## Design

**Where code goes.** `routes/` wires middleware to handlers · `controllers/` handle HTTP · `services/`
hold the rules · `repositories/` own the queries · `validations/` own the request shapes. `engine/` is
the deterministic review logic and `io/` is Excel, both pure and free of HTTP and SQL.

**Validate at the boundary.** Every request body has a Zod schema in `validations/`. `validateBody`
drops fields the schema does not declare, so declare every field a handler needs.

**One error shape.** Throw `ApiError` (`utils/api-error.ts`) with a stable code; `errorHandler` writes
`{ error: { code, message, details? } }`. 4xx: do not retry. 5xx: retry shortly. Never swallow an error.

**Config, not literals.** Models, rates, limits and timeouts live in `config/service.json` and are read
through `config/constants.ts`. Secrets go in the environment only; startup refuses them in the file.
Run `npm run config:check` after editing config.

**Identity is authorisation.** The owner comes from `x-aastrika-creator`, set by the uiproxy from the
session. It is required (401 without it) and scopes every read. No body fallback, no default user.
The service must only be reachable through the proxy.

**Migrations are numbered.** Add `migrations/00N_name.sql`; never edit an applied one. The runner
applies each once, in a transaction, under an advisory lock.

**Prompts are verbatim.** METHOD, SOURCE_LIBRARY and the method paragraph must be copied exactly from
the prototype (`frac-studio.html`). Never invent wording for them.

## Code standards

1. Files under 600 lines (800 hard cap); a function does one thing.
2. No magic numbers: a named constant with a comment, or a setting in `config/`.
3. Pure logic apart from I/O, with tests.
4. JSDoc on every export, saying what and why.
5. Typed and strict: no `any`, no `@ts-ignore`, no unused code; lint and typecheck clean.
6. Log through `utils/logger.ts`, never `console.*`.
7. No new dependency without asking.
8. Every production bug earns a regression test.

`npm run check` runs typecheck, lint, config check and tests.
