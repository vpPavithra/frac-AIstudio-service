# AI Studio: FRAC Creator and FRAC Reviewer (developer spec)

**Version:** v1, 28 Oct 2026
**Owner:** Sarvesh Deshpande (sarvesh@aastrika.org)
**Status:** prototype tested, ready for production build
**Reference prototype:** `FRAC Studio/frac-studio.html` is a single-file working prototype. It is the behavioural reference for this spec. Line numbers below (e.g. `L362`) point into that file.

---

## 1. What we are building

AI Studio gets a FRAC module with two tabs, in the same style as the existing Video and Assessment tabs.

**FRAC Creator**
- The user gives a cadre, a state (or the India national baseline), a short brief and, optionally, job descriptions or government orders.
- AI agents build a full FRAC competency dictionary in the Aastrika format: Position → Roles → Activities → Competencies → L1–L5 ladders.
- The team edits every step, gives feedback to revise, runs an expert check and downloads Excel.

**FRAC Reviewer**
- The user uploads an existing FRAC dictionary (.xlsx).
- The system reviews it against the FRAC concept, Bloom's taxonomy, Mission Karmayogi (KCM / 4-point scale) and current Indian guidelines.
- The output is a graded report.
- The user can then open the reviewed FRAC in the Creator to fix it.

**My FRACs** is a third tab: the library of saved FRACs and past reviews.

**Design principle: computed counts plus agent judgement.**
- Everything countable is computed in code and is deterministic: Bloom verb violations, unmapped activities, incomplete ladders, outdated law names.
- The LLM only judges what code cannot: scope, clinical accuracy, granularity, ladder logic and Karmayogi alignment.
- The LLM is told the computed counts and must not recount them.

**Agents are personas inside prompts, not separate services.**
- **Kaushal** is a FRAC/HR architect.
- **Vidya** checks clinical and programme accuracy for Indian frontline health.

---

## 2. Production architecture (recommended)

The prototype runs entirely in the browser and calls Claude through the artifact runtime. Production should move the logic server-side.

| Concern | Prototype | Production |
|---|---|---|
| LLM | `sample.json(prompt, {modelTier})`, no model pinned | Server-side Anthropic API. `claude-opus-5-5` for the complex tier and `claude-sonnet-5-5` for the default tier (section 9). Use JSON output via tool-use or a strict JSON schema. |
| Storage | Artifact `db` (head doc plus 10-competency parts) | Postgres, using the shared AI Studio / AskMe Postgres on `aastrika_net`. Use JSONB columns or normalised tables (section 4). |
| Uploads | Browser text extraction (pdf.js, mammoth) | Server extraction: reuse `server/sources.js` from AI Studio (PDF/DOCX/TXT plus Drive/S3 links). |
| Excel | `xlsx-js-style` in the browser | Either is fine. Server-side generation (exceljs / openpyxl) is easier to test. |
| Long steps | Awaited in the browser | Background jobs with progress polling, the same pattern as `/api/jobs/:id` in AI Studio. |
| Auth | none | Same JWT as AI Studio / AskMe (`server/auth.js`). |
| Web search | none (built-in knowledge plus uploads only) | **New in production:** let the research step search for the JD (section 5.2). |

**UI** must match AI Studio exactly:
- White background only, no dark mode.
- Inter font, primary colour `#3B4CD8`.
- Big title over a faint blue/lavender wash.
- A segmented tab bar with a numbered stepper.
- Step cards with an icon tile, a Required/Optional/Done tag and a "Step n of N" pill.
- A sticky summary sidebar on the right with the primary action button.
- Responsive breakpoints at 1180 / 900 / 600 px.

---

## 3. Domain rules (non-negotiable)

These rules go into **every** Creator and Reviewer prompt as a `METHOD` block. The verbatim text is at `L244–255`; port it unchanged.

1. **JD first.** The build order is Position → Roles → Activities → Competencies. Start from the job description and the places where the cadre is deployed, never from a syllabus.
   - Roles are areas of work ("Conduct VHSND sessions"), never curriculum subjects ("Anatomy & Physiology").
2. **Activities use performance verbs** (Conduct, Screen, Refer, Maintain). Never use Describes / Explains / Knows / Understands.
3. **Competency types follow the CBC Karmayogi Competency Model (KCM).**
   - Behavioural (13 in KCM).
   - Functional (21 in KCM).
   - Domain (department-defined).
   - Mostly Domain, plus a real mix of Functional and Behavioural competencies.
4. **Five cumulative levels:**
   - L1 Foundational
   - L2 Assisted
   - L3 Independent
   - L4 Complex
   - L5 Expert/Mentor

   This is a *declared deviation* from Karmayogi's 4-point scale. The crosswalk is: L1 = Awareness · L2 + L3 = Application · L4 = Leveraging knowledge & taking decisions · L5 = Subject matter expert.
5. **Bloom's rule has no exceptions.**
   - Every level label and every indicator starts with a measurable verb.
   - Banned at every level: Understands, Knows, Learns, Is aware of, Appreciates, Is familiar with.
   - Behavioural competencies use Krathwohl's affective ladder (Receives → Responds → Values → Organises → Internalises), written as observable behaviour.
6. **Level description = 2–4 indicators.** Each indicator after the first goes on a new line starting with `-`. Every indicator must be assessable by OSCE, observation, record audit or MCQ.
7. **Mapping.**
   - Each activity maps to exactly one competency at the level the job demands (`competency@level`, usually L3 or L4).
   - L1/L2 are rarely demanded.
   - Use L5 only for audit or mentoring activities.
   - Every competency must be used by at least one activity.
8. **Scope.**
   - Never put an act beyond the cadre's legal or programme scope.
   - Every activity carries a source tier: `JD` | `Programme guideline` | `Facility standard` (IPHS 2022 / NQAS / LaQshya) | `Inferred – verify`.
   - *Taught in the curriculum ≠ authorised by the employer.*
9. **Current names only.** Mental Healthcare Act 2017, NDPS Act 1985, MTP (Amendment) Act 2021, PCPNDT 1994, POCSO 2012, Ayushman Arogya Mandir (formerly HWC), NTEP, NP-NCD, NCVBDC, Td (not TT), U-WIN, RCH portal, IPHS 2022, NQAS, LaQshya, MusQan, SUMAN, WHO Labour Care Guide.
10. **Never invent page numbers, circular numbers or URLs.** If unsure, mark the fact "verify".

The research step also gets a `SOURCE_LIBRARY` block (`L257–265`). It lists:
- IPHS 2022 annexures with JDs.
- AAM guidelines, ASHA modules, ANM/MPW job responsibilities.
- SBA 2010 Annexure IX, Dakshata, LaQshya, MusQan, SUMAN, HBNC/HBYC, IMNCI.
- National programme guidelines.
- INC syllabi ("teaching scope only").
- KCM, the FRAC Introduction Pack and the Karmayogi Quality Framework.

---

## 4. Data model

### 4.1 FRAC (the Creator object)

```jsonc
FRAC {
  id, createdAt, updatedAt, ownerId,
  step: 1..6,
  cadre, cadreFull, state, size: "compact"|"standard"|"full", prompt,
  imported?: "source filename",          // set when created from a review
  codePrefix: "ANM",                      // A–Z only, ≤4 chars, fallback "C"
  postings: [{ key: "P1", label: "ANM at Sub-Centre (outreach)" }],   // as many as the brief names, or none (review 13 Nov 2026; was 1–3)
  research: {
    summary, sourceNotes,
    sources: [{ title, issuer, year, use, tier }],   // tier: JD | Programme guideline | Facility standard | Curriculum (scope only)
    authorised, notAuthorised, stateContext,           // newline-separated text, editable
    assumptions                                        // includes "VERIFY: …" lines
  },
  roles: [{
    code: "R1", title, source,
    activities: [{
      code: "A1",                 // numbered globally across roles
      text,
      postings: { P1: "Yes"|"No"|"" },
      source, tier,               // JD | Programme guideline | Facility standard | Inferred – verify
      comp: "ANM3@L3"             // competency@level
    }]
  }],
  competencies: [{
    code: "ANM1", label, description,
    type: "Domain"|"Functional"|"Behavioural",
    area, kcm,                    // kcm = KCM competency name, or "Domain – department-defined"
    levels: null | [{ label, desc }] × 5      // desc = indicators joined by "\n-"
  }],
  rolesDirty: bool,               // roles edited after competencies derived
  review: Report | null,
  log: [{ at, step, feedback }]
}
```

**Production storage.**
- In Postgres, use `fracs(id, owner, cadre, state, updated_at, doc jsonb)`. A single JSONB doc is fine because FRACs stay under 1 MB.
- The prototype split competencies into parts of 10 only because of the artifact db size limit. Production does not need that split.
- Keep version history: save a snapshot on each step completion, because users will want to roll back a bad revise.

### 4.2 Review model (normalised input to the review engine)

Both tabs feed the review engine this shape. It comes from `fracToModel` (Creator) or `parseWorkbook` (upload).

```jsonc
{ title, hasFrac,
  postings: ["P1",…], postingLabels: [...],
  roles: [{ code, title, refs?, activities: [{ code, text, postings, refs: [{ code, level|null }] }] }],
  competencies: [{ code, label, description, type, area, levels: [{ label, desc }] }] }
```

### 4.3 Report

```jsonc
{ title, cadre, state, at,
  stats: { roles, activities, competencies, indicators, B, F, D, other },
  verdict: "one sentence",
  triage: "use"|"revise"|"rebuild",
  summary: "2–3 sentences",
  checks: [{ key, name, n, status, cls }],   // see 6.4
  findings: [{ check, sev: "B"|"M"|"m", title, detail, refs: [], fix, source: "computed"|"agent", fixed? }],
  strengths: [] }
```

Save each review in `reviews(id, owner, created_at, ctx jsonb, report jsonb)`. **Also store the parsed source model.** The prototype dropped it, so a past review could not be reopened in the Creator (section 10).

---

## 5. FRAC Creator: step by step

There are six steps. The stepper and the sidebar's primary button follow `curStep()`:

| curStep | Condition | Primary button |
|---|---|---|
| 0 | No research yet | "Research the job" |
| 1 | No roles yet | "Build roles & activities" |
| 2 | No competencies, or `rolesDirty` | "Derive competencies" / "Re-derive competencies" |
| 3 | Some competency has `levels == null` | "Write level ladders" |
| 4 | No review yet | "Run expert check" |
| 5 | Otherwise | "Download Excel" |

**Every generation step has a feedback box and a Revise button.**
- Revise re-runs the step with the current output (including the team's edits) plus the feedback.
- The prompt says "keep what the team edited unless the feedback says otherwise".

### 5.1 Step 1: Brief

**Fields:**
- **Cadre:** free text with suggestions from a list of 27 Indian health cadres, ASHA through Anganwadi Worker (`L227`). Required.
- **State:** "India (national baseline)" plus every state and UT.
- **Scope ("What should this FRAC cover?"):** a textarea.
- **Size:**

  | Size | Roles | Activities per role | Competencies |
  |---|---|---|---|
  | compact | 6–8 | 4–6 | 16–22 |
  | **standard** (default) | 10–14 | 5–8 | 28–40 |
  | full | 15–19 | 6–9 | 45–60 |

- **Optional uploads:** JDs and government orders as PDF/DOCX/TXT/MD, or pasted text. In the prototype each upload is capped at 60k characters and PDFs at 80 pages.

The brief locks once research exists.

### 5.2 Step 2: Job research (Kaushal), complex tier

**Prompt.** It contains, in order:
1. The persona.
2. The brief.
3. The METHOD and SOURCE_LIBRARY blocks.
4. The uploaded documents, labelled "use these first; quote what they say about duties", with a 60k total cap.
5. On revise: the previous research and the team feedback.

**The prompt asks for:**
- The applicable JD documents.
- Postings as the brief and documents name them: one, several or none (review 13 Nov 2026; was 1–3). These become the FRAC columns, e.g. "ANM at Sub-Centre (outreach)" and "ANM at delivery-point PHC".
- What the cadre is and is not authorised to do.
- What changes for this state: programmes, cadre names, endemic diseases, languages, portals.
- For the national baseline: what each state must customise.

**Output:**
```json
{"cadreFull":"","codePrefix":"2–4 capitals","summary":"6–10 sentences",
 "postings":[{"key":"P1","label":""}],
 "sources":[{"title":"","issuer":"","year":"","use":"","tier":""}],
 "authorised":[],"notAuthorised":[],"stateContext":[],"sourceNotes":"","assumptions":[],"verify":[]}
```

**Post-processing in code:**
- Sanitise `codePrefix`.
- Keep every posting returned, re-keyed P1, P2…. If none come back, keep none: the team adds them (review 12–13 Nov 2026: no cap of 3, no fallback posting).
- Join the arrays into newline-separated text.
- Prefix each `verify` item with "VERIFY: " and append it to the assumptions.

**Editable:** summary, posting labels, authorised, notAuthorised, stateContext, assumptions.
**Read-only:** the sources table.

**Production addition: web search.** Give the research step a search tool restricted to government domains (nhm.gov.in, mohfw.gov.in, state NHM sites, igotkarmayogi.gov.in, cbc.gov.in). It finds the actual JD and returns real citations. Keep rule 10: never invent URLs or page numbers, and show only links that were actually retrieved.

### 5.3 Step 3: Roles and activities (Kaushal)

**3a. Roles, one call, complex tier.**
- Context: brief, edited research (labelled "treat as authoritative"), METHOD.
- Ask for `{size.roles}` roles covering the whole job across all postings. Each role is written as an action and includes non-clinical work: records, stock, supervision, mobilisation.
- Output: `{"roles":[{"title":"","source":""}]}`. Code assigns R1..Rn.

**3b. Activities: batches of 4 roles, 3 batches in parallel, default tier.**
- Ask for `{size.acts}` activities per role: observable workplace actions with performance verbs.
- For each activity: Yes/No per posting, the source document and the source tier.
- On revise, pass the earlier activities of matching roles as "keep good ones".
- Output: `{"roles":[{"code":"R1","activities":[{"text":"","postings":{"P1":"Yes"},"source":"","tier":""}]}]}`

**After 3b, code:**
- Renumbers activities globally (A1..An).
- Clears all `comp` values.
- **Clears the competencies and the review.** See the fix in section 10.

**Editable:**
- Role title.
- Activity text.
- Posting Yes/No/blank.
- Competency@Level (free text).
- Add activity (source "Added by team").
- Delete activity.

**Production should also allow** adding, deleting and reordering roles. The prototype did not.

Editing a role or activity text after competencies exist sets `rolesDirty`. The UI then shows: "Roles changed after competencies were derived. Re-derive competencies to refresh the mapping."

### 5.4 Step 4: Competencies (Kaushal), one call, complex tier

**Prompt:**
- Derive the competencies **last**, from the activities.
- Ask for `{size.comps}` competencies coded `{prefix}1…`, each with:
  - label (noun phrase)
  - description (one sentence starting with a verb)
  - type (B/F/D)
  - area
  - kcm: the KCM name, or "Domain – department-defined"
- Every activity maps to exactly one competency, and every competency is used at least once.
- On revise: "keep existing codes; mint new codes after the highest one".

**Output:**
```json
{"competencies":[{"code","label","description","type","area","kcm"}],
 "mapping":[{"a":"A1","c":"ANM1","l":3}]}
```

**Code then:**
- Writes `activity.comp = "c@Ll"`.
- Keeps a competency's existing ladder only if both its code **and** its label are unchanged; otherwise the ladder is nulled.
- Clears the review and `rolesDirty`.

**UI:**
- D/F/B counters.
- An editable table: label, type, area, description, KCM.
- A computed "Used by" column. A competency used by nothing shows a red "none".

### 5.5 Step 5: Level ladders (Kaushal + Vidya)

**Batching:** 4 competencies per batch, 3 batches in parallel, default tier. Save after each batch and show progress ("x of y competencies").

**Prompt.** Kaushal writes and Vidya checks each clinical fact. Context:
- Brief, authorised and not-authorised scope, METHOD.
- Per competency: code, label, type, description, the activities using it (with levels), and the current ladder if one exists.

**Instruction:**
- Write L1–L5.
- Each level has a one-line label that starts with a measurable verb and is distinct from the other levels.
- Each level has a desc of 2–4 indicators.
- Levels are cumulative. L5 covers audit, mentoring and improving the system.
- Clinical content follows current Indian national guidelines and stays within the authorised scope.

**Output:** `{"ladders":[{"code":"","levels":[{"label","desc"}×5]}]}`

**Triggers:**
- Write all missing ladders.
- "Rewrite all ladders".
- Per-competency feedback with a "Revise {code}" button, which rewrites only that competency.

**Editable:** every level label and indicator, in a collapsible card per competency.

### 5.6 Step 6: Expert check and download

**Expert check:**
- Runs the **same review engine as the Reviewer** (section 6) on `fracToModel(f)`, with notes "Generated in FRAC Studio. Be strict."
- Shows the report inline.
- A **"Fix these competencies"** button appears on findings that reference competency codes. It re-runs ladder writing for those codes with feedback built from the finding: "Fix this review finding: {title}. {detail} Suggested fix: {fix}".
- Findings about the whole FRAC say: "add it as feedback in step 3 or 4 and revise there."

**Download Excel:** see section 7.

---

## 6. FRAC Reviewer (also used as the Creator's expert check)

There are three steps: Upload FRAC → Context (optional) → Review report.

### 6.1 Workbook parsing (`parseWorkbook`, L605)

The real dictionaries are inconsistent, so the parser must be tolerant.

**Sheets**
- Skip Hindi copies, i.e. sheet names matching `/\(H\)|hindi/i`.
- Scan the first 12 rows of each sheet for a header row. Header cells are trimmed and lowercased.
- **Competency sheets (all of them, not just the first):** a header matching `/competenc.*code|^code$/` **and** one matching `/level\s*1|applicable level|theme\s*1/`. Files often split Domain, Functional and Behavioural across sheets (the Meghalaya ANM file has three). Reading only the first sheet made earlier reviews wrongly report "0 Behavioural, 0 Functional".
- **KCM-format sheets:** when a competency sheet has `Applicable Level` and `Theme n Description / Indicators` columns but no `Level n Label`, read each row as `format:"kcm"` with `themes[]`, `applicableLevel` and `levels: []`. If the type column is blank, take the type from the sheet name (Domain / Functional / Behavioural).
- **Position:** a cell like `Position: ANM` in the first 12 rows sets `model.position`, which is used to infer the cadre.
- **FRAC sheet:** a header matching `/^role/` **and** one matching `/^activit/`, **or** a single `Roles/Activities` column plus a `Description` column (the Meghalaya layout: codes in the first column, text in the second).
- No competency sheet → error: *"Could not find a competency sheet. It needs a header row with "Competency Code" and "Level 1" columns."*
- No FRAC sheet → continue with `hasFrac=false` and show "structure and coverage checks will be limited."

**Competency columns:**

| Field | Regex |
|---|---|
| code | `competenc.*code\|^code$` |
| label | `competenc.*label\|^label$` |
| description | `competenc.*desc` |
| type | `type` |
| area | `area\|subject` |
| level n label | `level\s*n\b.*label` |
| level n description | `level\s*n\b.*desc` |

- Drop rows with an empty code.
- **Bug to fix:** the description regex also matches "Competency Level 1 Description". Exclude headers that contain "level".

**FRAC sheet columns:**
- Role: `^role`.
- Activity: `^activit`.
- Mapping: `compe?t|mapping`. This tolerates the ANM file's "Comptency" typo.
- **Posting columns** = every other non-empty header that does not match `source|tier|applicab|note|desc`.
- `model.hasMapping` = a mapping column exists. When it doesn't, skip the unmapped/unused checks and raise one minor "Activities are not mapped to competencies yet" instead.

**Rows:**
- A row is a **role** if its code starts with `R`, or if there is no current role and the code does not start with `A`.
- Otherwise it is an **activity** under the current role.
- Role rows can also carry mapping refs, which count as "used".

**Mapping parser (`parseRefs`, L592).** Uppercase the input, then apply in order:
1. **Bare numbers** (`26`) become `{dominant prefix}26`. The dominant prefix is the most common code prefix in the competency sheet.
2. **Code with a level range:** `ME50L2-L5` or `ME50 L2–L5` → `{ME50, level 5}`. The highest level wins.
3. **Code ranges:** `C3-C14` or `C3-14` expand to C3..C14 (cap 80). A bare `L` is never a prefix, so `L2-L5` is not read as a code range.
4. **Single codes:** `C12`, `C12@L3`, `C12 L3`, `C12L3`.
5. Deduplicate by code; the first occurrence wins.

**Required test fixtures:**
- `ANM competencies 6aug2026.xlsx` (role-row ranges, "Comptency" typo)
- `GNM COMPETENCY DICTIONARY 9 June 2025.xlsx` (codes like `ME50L2-L5`, Hindi sheets; openpyxl cannot open its stylesheet, so use a tolerant reader)
- `Staff Nurse competencies - India v0.1.xlsx`
- `[Shared with Aastrika] GO-HRM Meghalaya (ANM FRAC).xlsx` (Domain + KCM Functional + KCM Behavioural sheets, single-column Roles/Activities sheet, no mapping)
- Our own Creator export (round trip)

All four are in `Claude content/FRAC/` or on the T7 drive; ask Sarvesh for copies.

### 6.2 Context (optional)

- Cadre (inferred if blank).
- State ("Not state-specific" allowed).
- Reviewer notes, e.g. "built 3 years ago by an agency; to be adapted for Bihar".

### 6.3 Computed checks (`computeChecks`, L509)

These are deterministic, so they give the same result on every run. Each finding has the shape `{check, sev, title, detail, refs[], fix, source:"computed"}`. Severities: **B** = Blocker, **M** = Major, **m** = Minor.

**Design rule (engine r2):** anything that can be decided by a list or a pattern belongs here, not in the LLM. In the old engine, one open-ended LLM call chose titles, severities and fixes, so two runs on the same file shared only 6 of 26 finding titles. Moving scope, ladder, coverage and overlap rules into code made 31 of 31 findings identical across three runs (see 6.6). Current engine version: **r3** (r3 added the catch-all and above-the-post breadth rules).

**Cadre family** — `cadreFamily(ctx.cadre || model.position || model.title)` → `anm` (ANM, MPW, LHV), `asha`, `cho`, `nurse` (Staff Nurse, GNM) or none. Frontline families (`anm`, `asha`, `cho`, `nurse`) turn on the scope, ladder, coverage and KCM-relevance rules below. Keep the rule tables (`SCOPE`, `LADDER_RULES`, `AREAS`, `OUTDATED`) in config files that clinical reviewers can edit.

**Verb regexes**
- `BANNED = /^(understand|understands|understanding|know|knows|knowing|knowledge of|has knowledge|learn|learns|is aware|aware|appreciate|appreciates|is familiar|familiar|realis|realiz|comprehend)/i`
- `SYLLABUS = /^(describe|describes|explain|explains|list|lists|enumerate|enumerates|define|defines|understand|understands|know|knows|state|states|discuss|discusses)\b/i`
- Strip leading `- • * 1. )` before testing the first word.

| Check | Rule | Severity |
|---|---|---|
| **Bloom's verbs** | Level labels starting with a BANNED verb, counted per level | M if the worst level ≥ 25% of competencies, else m. Add "Levels 1 and 2 barely differ" if both are affected |
| | Indicators only (labels clean) | m |
| **FRAC structure** | Activities starting with a SYLLABUS verb | M if ≥ 30%, m if > 0 |
| | Every competency untyped | M |
| | No Behavioural or no Functional competencies | M. Fix: "add B/F mapped to KCM (13 B + 21 F)" |
| | Role with fewer than 2 activities | m |
| | No Role–Activity sheet | M |
| | **Competencies are too broadly defined:** one finding that gathers (a) catch-all labels (`CATCH_ALL`: "Clinical Skills", "… protocols & guidelines", "Programmes/Schemes"); (b) Domain competencies spanning 3+ clinical `AREAS` that also share them with 2+ others; (c) labels that are lists of national/state programmes or schemes; (d) frontline only: content pitched at the district/state system (`ABOVE_POST`, e.g. "District Health Organization & Functioning"); (e) definitions that are topics ("Knowledge of / Understanding of…"). The finding opens with "{n} of {N} Domain competencies are too broad to assess as one job capability". | M if (a)–(d) hit, m if only (e) |
| | Tagged Domain but label matches a KCM Functional/Behavioural name (knowledge sharing, communication, coordination, community engagement, data, planning…) | m |
| | Frontline only: KCM Functional competencies the post does not demand (Policy Architecture, Financial Management, Procurement, Administration Matters…) | m |
| **Level ladder** | Competencies with fewer than 5 level labels | M if > 10% of competencies, else m |
| | Same L5 label on 3 or more competencies | M, one finding per label |
| | Same label at two levels of one competency | m |
| | KCM-format competencies with no L1–L5 job ladder | M |
| | **Ladder shift** (`LADDER_RULES`): L1–L2 say "independently"; frontline only: L3 has supervising/mentoring/training others; L4–L5 name policy, research, representing the district/state | M, one finding with a count and codes per rule, and the canonical re-anchoring fix |
| **Coverage & sources** | Unmapped activities | M if ≥ 5%, else m. Quote the first 3 |
| | Competencies never used | m |
| | Refs to undefined codes | M |
| | Some (not all) activities with every posting blank | m |
| | **Core areas with no dedicated competency** (`AREAS[family]`, matched on competency label + description). ANM/CHO list = the Ayushman Arogya Mandir service packages plus programme areas; nurse list adds medication safety, ward management, patient safety/quality, legal and ethical practice. Name the activities that need each missing area. | M |
| **Guidelines & context** | `OUTDATED` regex list (below), scanned over activities, competencies and all level text | one finding per pattern, listing up to 12 codes |
| | **Scope** (`SCOPE[family]`), sentence by sentence over every definition and level. ANM rules: IV drug administration (cleared when the sentence is about IV access for referral), managing complications/complicated deliveries, curative management, debridement, independent management of severe cases, advanced resuscitation, unspecified emergency drugs, prescribing, operative/MTP procedures (all B), spraying/larviciding (M). ASHA rules: injections, conducting deliveries, prescribing. | one finding per act: codes with levels, a quoted example, what the cadre may do instead |

**`OUTDATED` list (L494).** Keep this list in a config file so clinical reviewers can extend it without a deploy.

| Pattern | Sev | Correct to |
|---|---|---|
| Lunacy Act / lunatic / lunacy | B | Mental Healthcare Act 2017 |
| Mental Health Act 1987 | B | MHCA 2017 |
| NDPS … 1965 | B | NDPS Act 1985 |
| `\bTT\b` / tetanus toxoid | M | Td (2018) |
| RNTCP | m | NTEP (2020) |
| NPCDCS | m | NP-NCD (2023) |
| HWC / Health & Wellness Centre | m | Ayushman Arogya Mandir (2023) |
| NVBDCP | m | NCVBDC |
| MCTS | m | RCH portal / U-WIN |
| MTP Act 1971 (without 2021 nearby) | m | MTP (Amendment) Act 2021 |
| NRT | m | NSSK / Helping Babies Breathe |
| RMNCH+A | m | RMNCAH+N |
| NRHM | m | NHM |
| VHND | m | VHSND |
| Five Rights (of medication) | m | expanded rights of medication administration |
| partograph, with no Labour Care Guide anywhere in the file | m | add the WHO LCG |
| ISO / Drugs & Cosmetics Act / medical device law (frontline only) | m | BMW Rules 2016 (as amended), Kayakalp/NQAS |

**Stats:** roles, activities, competencies, indicators (non-empty indicator lines), and the B/F/D/other counts by type prefix.

### 6.4 AI judgement on a fixed checklist (`aiChecklist`), complex tier

The LLM answers only fixed questions. It never writes titles, severities, fixes, the verdict or the summary.

**Per-competency call** (laddered competencies only, 6 per call, 3 in parallel). Persona: Vidya. The prompt lists what code already checks, including the exact scope hits for those competencies, and says not to repeat them. It asks the same two questions for every competency:
- **Q1 Scope:** does any sentence give the cadre a clinical or public-health act outside its authorised scope?
- **Q2 Accuracy:** is any drug, dose, schedule, cut-off, protocol, law or programme fact wrong or outdated for India today?

Every flag must copy 6–25 consecutive words exactly into `quote`; "an empty list is a good answer".
```json
{"items":[{"code":"","scope":[{"quote":"","act":"","basis":""}],"accuracy":[{"quote":"","issue":"","correct":""}]}]}
```

**State call** (only when a state other than national is set). Q3: what is missing that is specific to the state. Answers use five fixed categories (Disease burden, Delivery and referral, Language and culture, State schemes, Geography and access), at most 6 items, with "(verify)" where unsure.

**Verification in code:**
- A flag is kept only if its normalised quote (4+ words) appears in that competency's text. This drops paraphrases and hallucinations.
- A flag is dropped if a rule already covers it: the quote matches an `OUTDATED` pattern or a ladder rule, or a scope rule already hit the same competency and level.
- State items are sorted by category, then text.

**Merge into at most three findings, all with fixed titles and `source:"agent"`:**
- "Other acts beyond {cadre} scope" (B)
- "Clinical or programme facts to correct" (M)
- "Does not reflect {state}" (m)

**Sort:** severity, then check order, then rule-based before AI.

**Verdict, triage, summary and strengths are computed:**
- **triage** = `rebuild` if activities are syllabus outcomes, no competency is typed, or more than half the ladders are incomplete; `revise` if there is any Blocker or 3 or more Majors; otherwise `use`.
- **verdict** = "{triage text} — {nB} blockers, {nM} major and {nm} minor findings. Fix first: {n kinds of act beyond scope}; {next two B/M titles}."
- **summary** = what was checked, plus how many findings are rule-based and how many are AI judgement.
- **strengths** = the core areas covered, and checks with no findings.

**Repeatable results (`reviewOnce`):**
- `fingerprint = sha256({engine version, postings, roles, competencies, ctx})`.
- If a review with that fingerprint exists, return it with `fromCache:true`, and the UI says the file was reviewed on {date}.
- "Run a fresh review" re-asks (in the prototype, the `sample` cache is called with `refresh:true`) and replaces the stored review.
- In production, store the report keyed by fingerprint in Postgres, and bump `ENGINE_VERSION` whenever the rules or prompts change.

**Per-check status** = the worst severity among that check's findings:

| Worst severity | Status |
|---|---|
| B | "Fix before use" |
| M | "Needs work" |
| m | "Mostly fine" |
| none | "Pass" |

### 6.5 Report UI

- **Header:** verdict, triage ("Use with minor edits" / "Revise" / "Rebuild from the job"), summary, stats.
- **A 5-tile grid**, one tile per check, showing status and finding count:
  - Bloom's verbs
  - FRAC structure
  - Level ladder
  - Guidelines & context
  - Coverage & sources
- **Provenance line:** "{n} rule-based findings (the same on every run) · {n} AI judgement, each backed by a quote".
- **Saved-review note** when `fromCache`, with a "Run a fresh review" link.
- **Findings list:** BLOCKER/MAJOR/MINOR chip, title, detail, refs, suggested fix, and "rule-based check" or "AI judgement · quoted from the file".
- **Strengths.**
- **Buttons:** **Download review** (Excel) and **Open in Create FRAC to fix**. The second calls `modelToFrac` (`L641`), which imports the reviewed file as a FRAC at step 6 with the report attached.
- **Empty state:** before the first run, show the hard-coded GNM example report (`L953`) with an "Example report" badge.

### 6.6 Acceptance test (regression)

Reviewing `GNM COMPETENCY DICTIONARY 9 June 2025.xlsx` must reproduce:
- A **Blocker** for repealed laws (Lunacy Act 1912, "NDPS 1965", MHA 1987).
- **16 unmapped activities** (A31–A41 among them).
- **12 incomplete ladders**.
- Roughly 58/74 L1 labels with non-measurable verbs.
- Syllabus-style activities (~92/136 start with "Describes").

Reviewing `Staff Nurse competencies - India v0.1.xlsx` should give at most 1 minor finding from the computed checks. (Re-baseline this under r2: the coverage and ladder rules are new.)

Reviewing the **Meghalaya ANM FRAC** (state Meghalaya) must give:
- 31 competencies (17 D / 6 F / 8 B), 11 roles and 58 activities.
- No "lopsided mix" finding.
- A Major "Competencies are too broadly defined" naming D9, D29, D40, D47, D52, D53 and D56 (7 of 17), plus 13 definitions written as topics.
- A Major for the KCM F/B competencies with no job ladder.
- Ladder shift on 17 of 17.
- Missing areas: family planning, child health, mental health, elderly and palliative care, minor ailments.
- Scope Blockers in D42, D43, D44, D46 and D47.

**Repeatability test (must pass before release):** run the same file 3 times with the cache bypassed. The test should require all rule-based findings to be identical and the triage and verdict to be identical. AI findings should keep the same titles; their content may differ.
- **Old engine (r1):** 6 of 26 titles were stable, and the verdict changed every run.
- **Measured on r2** (3 runs, Gemini standing in for Claude): 31 of 31 titles and severities were identical, 29 of 31 were word for word the same, and the verdict and triage were identical.
- The harness is in the session scratchpad. Rebuild it in CI as `review.repeatability.test`.

---

## 7. Excel export

**Filename:** `{cadre} competencies - {state}.xlsx`.

**Styles:**
- Header: bold, font `#1F3B3E`, fill `#B7DDE0`.
- Role rows: bold, fill `#D9EDEF`.
- All cells: wrap, top-aligned.

**Sheet "FRAC"**
- Columns: `Role` | `Activity` | `P1: {label}` … (one per posting) | `Tentative Competency Label` | `Source` | `Source tier`
- Role row: R#, title, blank postings, the unique competency codes of its activities, source.
- Activity row: A#, text, Yes/No per posting, `ANM3@L3`, source, tier.

**Sheet "Competencies"**
- `Competency Code` | `Competency Label` | `Competency Description` | `Competency Type` | `Competency Area (PH/Digital/Data literacy)`
- Then `Competency Level n Label` and `Competency Level n Description` for n = 1..5.
- Then `KCM Alignment (CBC Karmayogi Competency Model)`.

**Sheet "Method & Sources"**
- Title row.
- Cadre, state, and "Built {date} in FRAC Studio (AI Studio) — draft for expert validation".
- Method paragraph (verbatim; see `L653` onward).
- Job summary, postings, authorised scope, not authorised / refer, state context, assumptions & to verify.
- One row per source.

**Sheet "Expert check"** (only if a review exists)
- Rows: Verdict, Triage, Summary, Method (engine version + file fingerprint), a blank row, then a header row.
- Columns: `Severity | Check | Finding | Detail | Refs | Suggested fix | Found by`. Found by is "Rule-based check" or "AI judgement (quoted)". Never use internal agent names in files that go to experts.

**Review download:** one sheet named "Review" with the same layout. Filename: `FRAC review - {title}.xlsx`.

**Round trip:** the exported file must re-import through the Reviewer parser without errors.

---

## 8. API (proposed)

```
POST   /api/fracs                         create from brief → {id}
GET    /api/fracs?owner=me                list (cadre, state, counts, updatedAt, worst severity)
GET    /api/fracs/:id
PATCH  /api/fracs/:id                     save team edits (debounced from the UI; prototype used 1.4 s)
POST   /api/fracs/:id/steps/research      {feedback?}           → job
POST   /api/fracs/:id/steps/roles         {feedback?}           → job
POST   /api/fracs/:id/steps/competencies  {feedback?}           → job
POST   /api/fracs/:id/steps/ladders       {codes?, feedback?}   → job   (codes omitted = all missing)
POST   /api/fracs/:id/steps/check                               → job
GET    /api/fracs/:id/export.xlsx
GET    /api/jobs/:id                      {status, msg, done, total, error}

POST   /api/frac-reviews                  multipart xlsx + {cadre?, state?, notes?} → job → report
GET    /api/frac-reviews?owner=me
GET    /api/frac-reviews/:id              {report, ctx, sourceModel}
GET    /api/frac-reviews/:id/export.xlsx
POST   /api/frac-reviews/:id/open-in-creator  → {fracId}
```

**Job progress messages** (shown in the UI; reuse these):
- "Kaushal is gathering the job description, postings and sources…"
- "Kaushal is drafting the roles from the job description…"
- "Kaushal is writing activities for {n} roles…" (x of y batches)
- "Kaushal is deriving competencies from the activities…"
- "Kaushal and Vidya are writing level ladders for {n} competencies…" (x of y competencies, with a progress bar)
- "Running the expert check (computed checks + Kaushal and Vidya)…"
- Reviewer: "Reviewing — computed checks, then Kaushal and Vidya…"

---

## 9. LLM calls

| Call | Tier | Suggested model | Batching |
|---|---|---|---|
| Research | complex | claude-opus-5-5 | 1 call (plus web search in production) |
| Roles | complex | claude-opus-5-5 | 1 call |
| Activities | default | claude-sonnet-5-5 | 4 roles per call, 3 parallel |
| Competencies | complex | claude-opus-5-5 | 1 call |
| Ladders | default | claude-sonnet-5-5 | 4 competencies per call, 3 parallel |
| Review: scope + accuracy checklist | complex | claude-opus-5-5 | 6 competencies per call, 3 parallel |
| Review: state fit | complex | claude-opus-5-5 | 1 call, only when a state is set |

- Make models env-configurable, as AI Studio does with `ANTHROPIC_REVIEW_MODEL`.
- Use temperature 0.2–0.4 for the Creator steps. For the **Reviewer, use temperature 0**, plus the fingerprint cache. Temperature 0 alone is not fully deterministic; the cache is what guarantees the same answer for the same file. Use the prompts verbatim from the prototype.
- Log tokens and cost per job, and show the cost in the UI as AI Studio does for videos.

---

## 10. Known prototype gaps: fix in production

1. **No retries or JSON repair.** One failed batch fails the whole step. Add per-call retry with backoff, a JSON repair pass, and partial-batch recovery (keep the batches that succeeded and retry only the failed ones).
2. **Revising roles wipes all competencies and ladders.** Instead, keep competencies and re-run mapping only, or warn and ask before discarding.
3. **"Fix these competencies" clears the whole review**, so the report vanishes and the `fixed` flags are lost. Keep the report, mark the finding fixed and offer "Re-run check".
4. **The fix button only rewrites ladders.** Findings about activities, types or KCM need their own fix path (route them to step 3 or 4 with pre-filled feedback).
5. **Multi-ref mapping cells.** In imported FRACs, "Used by" and the Excel role rollup read only the first code of `C1@L3, C2`. Parse all refs.
6. **Past reviews can't open in the Creator.** Store the parsed source model with the review.
7. **No add, delete or reorder for roles and competencies.** Add these.
8. **The competency description regex** can grab a level description column (section 6.1).
9. **Orphaned storage parts.** These are artifact-db specific and go away with Postgres.
10. **The expert check isn't saved to the `reviews` collection.** Decide whether it should appear in My FRACs reviews.

---

## 11. Open questions for product (Sarvesh)

- **Assessment type per level.** The board deck shows "Assessment type: Knowledge / Skill / Knowledge + skill" and "Assessed by: OSCE + E-Kshamata" per level (Option B). The prototype does not generate these yet. Add them as a column in the competency ladder?
- **Authorisation source per level.** Our Staff Nurse dictionaries carry a per-level `Authorisation Source` (SBA-floor / Facility / State / Pending) and `Critical Steps`. Should these be in v1?
- **Hindi output.** The Karmayogi Quality Framework expects Hindi + English. Do we want a Hindi sheet in v1?
- **Collaboration.** Should multiple reviewers comment on or approve a FRAC (human panel sign-off), or is v1 single-owner?
