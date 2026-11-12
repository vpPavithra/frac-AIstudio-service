# FRAC Studio review decisions (Nov 2026): what changed and where

Built 11 Nov 2026 across two repos:
- frac-studio-service, branch `feat/frac-studio-workbook-export`;
- orgportal, branch `feat/frac-studio`.

uiproxy needs no change:
- `/protected/v8/fracStudio/*` already forwards uploads and the new routes.
- `/proxies/v8/entity/v1/*` already serves the Positions master.

Cost and token effect of each decision: [../COST_IMPACT_REVIEW_DECISIONS.md](../COST_IMPACT_REVIEW_DECISIONS.md).

## At a glance

| # | Decision | What the user sees | Service | Portal |
| --- | --- | --- | --- | --- |
| 1 | Upload Document | "Job description or government order" on the brief and the Research tab (PDF, DOCX, TXT; up to 3) | New documents API, text extraction, research prompt block | Brief form, Research tab |
| 2 | Name label → "Agent" | The AI panel and progress lines say "Agent" / "The agent is…" | Job messages | Job copy, check hint |
| 3 | Roles preview | "Preview roles" button on the Level ladders tab opens a popup once every activity is mapped | — | New preview component, popup |
| 4 | View Source | A View icon on every source row opens the page or document; URL column in the Excel | The agent gives each link; only checked, real links are kept | Research editor |
| 5 | Cadre → Positions | "Position" everywhere a label said "Cadre" | Validation message, Excel label | 7 templates, hints, tracker |
| 6 | Standard documents | Upload slots for Roles, Sources and Competencies sheets, each with "Download template"; that step then uses the sheet | Importers, templates, step short-cuts | Upload slots |
| 7 | No Standard / Full | The brief has no size choice; the agent chooses during research | `size` optional, `sizeBy`, research picks the size | Brief form, brief card |
| 8 | Position matching | While typing the position: "Found ANM in your FRACs…" / "…in Positions…" / "No position named … yet" | Match endpoint, seeded create | Match card on the brief |

## 1. Upload Document in the AI creation flow

- **Behaviour.**
  - A team attaches up to 3 job descriptions or government orders, on the brief or on the Research tab before
    research runs.
  - Only the text is kept: PDF via `unpdf`, Word via `mammoth`, or plain text. It is capped at 30,000 characters.
  - Research reads the documents first and runs 1 web search instead of 3.
  - Documents lock once research exists (409 `BRIEF_LOCKED`). A scanned PDF with no text layer is refused with
    `FILE_UNREADABLE`.
- **Service.**
  - `migrations/010_frac_documents.sql`: the new `frac_documents` table.
  - `src/models/document.model.ts`, `src/repositories/document.repository.ts`: storage, pg and memory.
  - `src/services/documents/extract-text.ts`: text extraction.
  - `src/services/document.service.ts`: upload, list and remove.
  - Routes in `src/routes/frac.routes.ts`, handlers in `src/controllers/document.controller.ts`.
  - `src/services/ai/prompts.ts` `researchPrompt`: the TEAM DOCUMENTS block.
  - `src/services/ai/research.step.ts`: sets `searchMaxUses`.
  - `src/providers/text/claude.ts`: honours `searchMaxUses`.
  - Settings `DOC_MAX_CHARS`, `DOC_MAX_BRIEF_FILES`, `RESEARCH_SEARCH_MAX_USES_WITH_DOCS` in `config/service.json`.
  - New dependencies `mammoth@1.13.0`, `unpdf@1.9.1`.
- **Portal.**
  - `components/document-upload/`: the upload slot.
  - `pages/creator-brief/`: files are uploaded right after the FRAC is created.
  - `pages/creator-detail/`: the Research tab slot.
  - `services/frac-studio-api.service.ts`: `uploadDocument`, `listDocuments`, `removeDocument`, `downloadTemplate`.
- **Affects.**
  - Research quality: it uses the team's own documents.
  - Cost: about −$0.03 per FRAC.
  - The database: one new table.
  - Nothing else in the flow changes.

## 2. Name label → "Agent"

- **Behaviour.**
  - The persona names Kaushal and Vidya no longer appear in the portal. Users see "Agent", "The agent is writing…" and
    "the agent's checklist".
  - The prompts keep the personas, so model answers, the stored answer reuse and costs are unchanged.
- **Service.** `src/services/queue/job-messages.ts`: every running-job message, plus a new `mapping` message.
- **Portal.**
  - `constants/frac-studio.constants.ts` (`FRAC_STUDIO_JOB_COPY`).
  - The expert check hint in `pages/creator-detail/creator-detail.component.html`.
- **Affects.** Wording only.

## 3. Competency level → roles preview

- **Behaviour.**
  - A "Preview roles" button on the Level ladders tab opens a read-only popup (a native `<dialog>`: Esc or × closes it).
  - For each role, every activity shows its posting Yes/No chips, the competency and level it maps to, and that
    level's label and indicators. A competency whose ladder is not written yet says so.
  - The button is enabled once every activity is mapped to a competency; until then a hint says why.
- **Portal.** `components/roles-preview/`, the button and popup in `pages/creator-detail/`, a hint in
  `utils/frac-studio-progress.util.ts`. It reuses `parseRefs` and `normalizeCode` from `utils/frac-studio-refs.util.ts`.
- **Affects.** Read only: no API call and no AI cost. No new tab; the six-step tracker is unchanged.

## 4. View Source

- **Behaviour.**
  - Each source can carry a link. A View icon on every source row opens the page or document in a new tab. A
    source with no real link shows the icon greyed out ("No link found"); there is no web-search fallback and no
    link text box.
  - The agent gives each source's `url`: the address of the page its search opened, or empty. Every link is
    checked before it is kept (`source-links.ts` `linkSources`):
    - a page the search returned is kept as it is;
    - with no `url`, the searched page whose title matches the source is used (`linkFor`);
    - any other address must be on `RESEARCH_SEARCH_DOMAINS` or `SOURCE_LINK_DOMAINS` (sites that host guidelines but are not searched, such as nhsrcindia.org and who.int) and answer a quick HEAD request
      (`SOURCE_LINK_CHECK_TIMEOUT_MS`, at most `SOURCE_LINK_MAX_CHECKS` per run), or it is dropped;
  - Checks never reach an internal address: only http(s) host names, no IP addresses, localhost or internal
    names, and every redirect target is checked the same way.
  - The "never invent URLs" rule stays in the prompt. A Sources sheet's URL column is used as it is.
  - The Excel "Method & Sources" table has a URL column.
- **Service.**
  - `src/models/frac.model.ts` `FracSource.url`.
  - `src/validations/frac.schema.ts`.
  - `src/providers/text/types.ts` `Citation`, `CompletionResult.citations`.
  - `src/providers/text/claude.ts` `searchCitations`.
  - `src/services/ai/ask-model.ts` `onCitations`.
  - `src/services/ai/schemas.ts` (`url` on research sources) and `prompts.ts` (the `url` field in the answer).
  - `src/services/ai/source-links.ts` `linkSources`, `linkFor`, `probeLink`, `webLink`; called from `research.step.ts`.
  - `src/config/constants.ts` `SOURCE_LINKS`.
  - `src/services/excel/workbook-writer.ts`.
- **Portal.** `components/research-editor/`: View column and `isWebLink`.
- **Affects.**
  - About 50 more output tokens per research run (one address per source); no extra calls.
  - Up to 10 short HEAD requests per research run, a few seconds at most, in parallel.
  - FRACs researched before this change get links when research is re-run.
  - With no search (a Sources sheet) the links come from the sheet's URL column.

## 5. "Cadre" → "Positions"

- **Behaviour.** Every user-facing "Cadre" now reads "Position" (one value) or "Positions":
  - the brief, the Creator brief card, the Reviewer form, My FRACs, the review report;
  - the research hints and the tracker;
  - the Excel "Method & Sources" label;
  - the "Position is required" validation message.
- **Not changed.** The API and database field is still `cadre`, and the prompts still say "Cadre". This keeps saved
  FRACs, the proxy and the stored answer reuse working, and needs no migration.
- **Files.**
  - Portal: `pages/creator-brief`, `creator-detail`, `reviewer`, `my-fracs`, `components/review-report`,
    `research-editor`, `constants`, `utils/frac-studio-progress.util.ts`.
  - Service: `frac.schema.ts`, `workbook-writer.ts`.

## 6. Standard documents for Role, Source and Competency

- **Behaviour.**
  - Upload slots: Roles tab (Roles sheet), Research tab (Sources sheet), Competencies tab (Competencies sheet).
  - Files may be .xlsx or .csv. Each slot has "Download template"; the brief slot downloads a short guide to what a
    JD should contain.
  - An upload replaces that part of the FRAC. A version is saved first, so History can undo it.
  - While a sheet is in use, its step uses it instead of the AI:
    - **Roles sheet:** the roles step keeps the roles and only writes activities for roles with none. With all
      activities present, no AI call runs.
    - **Competencies sheet:** the competencies step only maps activities to the sheet's codes, in one small
      `mapping` call. Competencies with all five levels in the sheet keep their ladder, so the ladders step skips them.
    - **Sources sheet:** research keeps those sources and does not search.
  - Removing the sheet keeps the content and hands the step back to the AI.
  - "Revise with feedback" still rebuilds with the AI.
  - An upload is refused while a step runs (409 `JOB_RUNNING`). An unreadable layout gives 400 `SHEET_NOT_RECOGNISED`
    with a pointer to the template.
- **Service.**
  - `src/services/documents/sheet-formats.ts`: one layout list shared by the templates and the importer. The layouts
    equal the Creator's own Excel download, so a download re-imports.
  - `src/services/documents/import-sheets.ts`: reuses the Reviewer's header helpers and `parseCompetencies`, now
    exported from `review-engine/parse-workbook.ts`.
  - `src/services/excel/csv-reader.ts`.
  - `buildTemplateWorkbook` in `src/services/excel/workbook-writer.ts`.
  - `GET /v1/templates/:kind`.
  - The `apply*Import` functions in `src/services/document.service.ts`.
  - `fillGaps` in `src/services/ai/roles.step.ts`.
  - `mapToSheet` and `mappingPrompt`/`mappingOutput` in `src/services/ai/competencies.step.ts`.
  - The `mapping` task in `src/providers/text/types.ts` and the mock.
  - `Frac.uploads`.
- **Portal.**
  - `components/document-upload/`, used three times in `pages/creator-detail/`.
  - Primary button labels "Write missing activities" and "Map activities to your competencies".
  - `curStep` in `utils/frac-studio-progress.util.ts`: research still runs before given roles are used.
- **Affects.**
  - The largest saving: up to −69% with all three sheets.
  - A sheet is used as it is, so its quality becomes the FRAC's.

## 7. Create FRAC form: Standard, Full and Custom removed

- **Behaviour.**
  - The brief has no size section. The research step chooses compact, standard or full from the breadth of the job
    and gives a one-line reason. The brief card shows "standard · chosen by the agent".
  - FRACs created before this change keep their size. An API caller that still sends `size` keeps it
    (`sizeBy: "team"`).
- **Service.**
  - `createFracSchema.size` optional.
  - `Frac.sizeBy` and `Frac.sizeReason`.
  - `newFrac` in `src/services/frac.service.ts`.
  - The `brief()` block and the SIZE line in `researchPrompt`.
  - `researchOutput.size` and `sizeReason`.
  - `researchPatch` applies the choice.
  - The mock returns a size.
- **Portal.**
  - The size fieldset is removed from `pages/creator-brief/`.
  - `FracBrief` no longer has `size`.
  - The brief card and the tracker evidence show who chose it.
- **Affects.**
  - Cost follows the job: a narrow job is cheaper (compact ≈ $0.63), a broad one costs more (full ≈ $1.38).
  - About 30 extra output tokens on research.

## 8. Position matching

- **Behaviour.** As the position is typed (debounced 0.5 s), the brief checks for an exact match:
  - **Earlier FRACs first.** It looks through the user's own FRACs (the same state ranks first). Case and spaces are
    ignored; nothing else is.
  - **Then the Positions master.** It checks the FRAC module's Positions master, through the existing entity API.
  - **On a match.** A ticked card offers to start from that position's postings and roles. The FRAC records
    `seededFrom`. Research keeps those postings, and the roles step needs no AI call, or only writes activities for
    roles that have none.
  - **No match.** It says "A new position will be created with this FRAC", and the team carries on.
- **Service.**
  - `GET /v1/fracs/match`: `FracService.match`, `FracRepository.findByCadre` (pg and memory).
  - `seed` on `POST /v1/fracs`: `seedContent` and `positionRoles` in `src/services/frac.service.ts`.
  - `Frac.seededFrom`.
- **Portal.**
  - `services/frac-studio-positions.service.ts`: reuses the FRAC module's `FracApiService.searchEntities` and
    `searchEntityHierarchy`, and `buildPositionMappingTree`.
  - The match card in `pages/creator-brief/`.
- **Limits.**
  - Earlier-FRAC matching covers only the user's own FRACs, because FRACs carry no organisation yet. Org-wide
    matching needs the proxy to pass the org id.
  - A Positions entry with no roles mapped starts as a new FRAC.
  - Creating the position in the Positions master itself stays in the FRAC module.

## Also changed on 11 Nov: draft Excel before the expert check

- **Behaviour.**
  - "Download draft Excel" sits beside "Run expert check" as soon as competencies exist, so the team can open and
    confirm the Excel before the check.
  - After a clean check the button reads "Download Excel".
  - A draft has no "Expert check" sheet (an out-of-date check is left out), and its "Built" row says "not yet
    expert-checked".
- **Service.** `src/services/excel/workbook-writer.ts` (`checked`), and a test in `workbook-writer.test.ts`.
- **Portal.** `canDownload` and `downloadIsDraft` in `pages/creator-detail/creator-detail.component.ts`; the
  button label and hints in its template.
- **Affects.** No AI calls. This reverses the earlier "download only after a fresh check" rule; the draft label and
  the dropped outdated findings keep its purpose.

## API added

| Method and path | Purpose |
| --- | --- |
| `GET /v1/fracs/match?cadre=&state=` | Position matching against the user's FRACs |
| `POST /v1/fracs` with `seed` | Start from a matched FRAC or Positions entry |
| `GET /v1/fracs/:id/documents` | Attached documents (no text) |
| `POST /v1/fracs/:id/documents` (multipart `file`, `kind`) | Attach a brief document or import a sheet |
| `DELETE /v1/fracs/:id/documents/:documentId` | Remove one |
| `GET /v1/templates/:kind` | `brief` (text guide), `roles`, `competencies`, `sources` (.xlsx) |

New error codes: `TOO_MANY_DOCUMENTS` (400) and `SHEET_NOT_RECOGNISED` (400). `BRIEF_LOCKED`, `JOB_RUNNING`,
`FILE_TYPE_NOT_ALLOWED` and `FILE_UNREADABLE` are reused.

## Tests

- **Service:** `npm run check` is green, with 184 tests passed and 3 skipped. New tests:
  - `src/mocks/review-decisions.test.ts`: 7 end-to-end cases on the mock, which assert the exact AI calls each case
    makes;
  - `src/services/documents/documents.test.ts`;
  - the citation test in `src/providers/text/claude.test.ts`;
  - migration 010 in `test/pg.test.ts`.
- **Portal:** typecheck and ESLint are clean. Jest and the production build run at commit, as the repo rule says.

## Deploy notes

- Migration 010 adds a table. It is safe to run before the new code.
- New settings have defaults; nothing to set unless tuning.
- Two new npm dependencies in the service image.
