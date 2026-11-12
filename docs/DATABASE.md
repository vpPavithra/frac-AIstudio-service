# Looking at the database (pgAdmin 4)

How to open the FRAC Studio Postgres database in pgAdmin 4 and look at what the service has stored. The service
reads the same connection settings from `.env` (`POSTGRES_*`, see `src/config/db.ts`).

## Connection details

Take the values from your `.env`. A local setup usually looks like this:

| pgAdmin field | `.env` setting | Local value |
| --- | --- | --- |
| Host name/address | `POSTGRES_HOST` | `localhost` |
| Port | `POSTGRES_PORT` | `5432` |
| Maintenance database | `POSTGRES_DATABASE` | `frac_studio` |
| Username | `POSTGRES_USER` | your Mac user name |
| Password | `POSTGRES_PASSWORD` | empty for a local Postgres that trusts local logins |

Never write a password into this file or any committed file. For a shared or deployed database, ask DevOps for the
values and keep them in pgAdmin's saved password or your `.env` only.

## Add the server (once)

1. Open pgAdmin 4. In the left panel, right-click **Servers** → **Register** → **Server…**
2. **General** tab: Name `FRAC Studio (local)` (any name works).
3. **Connection** tab: fill in the host, port, maintenance database, username and password from the table above.
4. **Save**. The server appears in the left panel; pgAdmin remembers it.

## Find the tables

**FRAC Studio (local)** → **Databases** → **frac_studio** → **Schemas** → **public** → **Tables**

| Table | What it holds |
| --- | --- |
| `fracs` | One row per FRAC. The whole document (research, roles, competencies, ladders, review, log) is in the `doc` column. |
| `frac_versions` | A snapshot of the FRAC after each step or revise. |
| `reviews` | Uploaded-file reviews and expert checks. `report` holds the findings, verdict and triage; `ctx` the cadre and state. |
| `jobs` | Each background step or review: status, progress message, error, and spend in `usage`. |
| `ai_calls` | One row per model call: provider, model, task, tokens, cost, latency. |
| `server_runs` | When each server run started and stopped. |
| `review_answer_cache` | Saved checklist answers reused for an identical review. |
| `frac_documents` | Documents attached to a FRAC (migration 010): `kind` is `brief` (a job description or order; its extracted text is in `text`) or `roles` / `competencies` / `sources` (a standard sheet; `parsed` holds the counts and warnings, and for sources the rows). The uploaded file itself is never stored. |
| `schema_migrations` | Which files in `migrations/` have been applied. |

The tables come from `migrations/` (`npm run migrate`, or on server start when `MIGRATE_ON_START` is on). If a table is
missing, the migrations have not run against this database.

## View the data

- Right-click a table → **View/Edit Data** → **All Rows** (or **Last 100 Rows** for a long table).
- `doc`, `report`, `ctx`, `usage` and `parsed` are JSON. In `fracs.doc`, `uploads` names the standard sheets in use and `seededFrom` the matched position. Double-click a cell to open it in a larger viewer.
- To see the columns and types, expand the table's **Columns** node, or select the table and open **Properties**.
- New rows from the app do not appear on their own: press **Refresh** (F5) in the data grid.

## Do not edit in the grid

The data grid is editable. Changing or deleting a cell and pressing **Save Data Changes** writes straight to the
database and changes what the app shows (a deleted `fracs` row also deletes its versions). Use pgAdmin to look, and
make changes through the app or the API. A deleted `fracs` row also deletes its `frac_documents` rows.
