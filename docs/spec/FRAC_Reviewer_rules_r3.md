# FRAC Reviewer: review rules (engine r3)

**For:** the developers building FRAC Reviewer in AI Studio
**Date:** 3 November 2026
**Goes with:** `FRAC_Creator_and_Reviewer_spec.md`, sections 6.1 and 6.3–6.6 and section 7. This file is the full rule set in one place.
**Reference code:** FRAC Studio prototype, `Claude content/FRAC Studio/frac-studio.html`. Everything between the markers `/*ENGINE>*/` and `/*<ENGINE*/` is the engine. It is plain JavaScript with no page dependencies, so you can port it as it is.

---

## 1. Why these rules exist

The first version of the reviewer made one open-ended LLM call. The model chose the findings, titles, severities, fixes and the verdict, so the same file produced different feedback on every run. Over three runs on the Meghalaya ANM FRAC, only **6 of 26** finding titles appeared every time, and the verdict changed each run.

**Engine r3 design rule:** anything that can be decided by a list or a pattern is decided in code. The LLM answers only three fixed questions, and every answer has to quote the file. Titles, severities, fixes, the verdict and the summary all come from code.

**Result:** 31 of 31 findings were identical in title and severity across three runs, 29 of 31 were word for word the same, and the verdict and triage were identical.

These numbers come from Gemini standing in for Claude in an offline test harness. The rule-based findings do not depend on the model.

**Keep the rule tables in config files** (JSON or YAML) so clinical reviewers can extend them without a deploy. Bump `ENGINE_VERSION` whenever a rule or prompt changes, because the version is part of the review fingerprint (section 9).

---

## 2. Parser changes

These are bugs from r1 that gave wrong findings.

| Change | Why |
|---|---|
| Read **all** competency sheets, not just the first. A competency sheet has a header matching `/competenc.*code\|^code$/` and one matching `/level\s*1\|applicable level\|theme\s*1/`. | The Meghalaya file keeps Domain, Functional and Behavioural on three sheets. r1 read only the Domain sheet, so it reported "0 Behavioural, 0 Functional" when there were 6 F and 8 B. |
| **KCM-format sheets:** the sheet has `Applicable Level` and `Theme n Description / Indicators` columns but no `Level n Label`. Read each row as `format:"kcm"` with `themes[]`, `applicableLevel` and `levels: []`. If the type cell is blank, take the type from the sheet name (`/behaviou?r/`, `/function/`, `/domain/`). | This is how the Functional and Behavioural competencies copied from the Karmayogi Competency Model appear in state files. |
| **Position:** a cell matching `/^position\s*:/` in the first 12 rows sets `model.position`, e.g. `Position: ANM`. | Used to infer the cadre when the user leaves it blank. |
| **Role–Activity sheet:** accept either `Role` + `Activity` headers, or a single `Roles/Activities` column (`/role.*activit/`) with a `Description` column (`/^desc/`). | The Meghalaya layout puts codes R1/A1 in column 1 and the text in column 2. r1 missed the sheet and wrongly reported "no roles and activities". |
| Posting columns exclude headers matching `source\|tier\|applicab\|note\|desc`. | Otherwise `Description` becomes a posting column. |
| `model.hasMapping` is true when a mapping column exists (`/compe?t\|mapping/`). | When it is false, skip the unmapped and unused checks and raise one Minor instead (section 4.5). |
| Bloom and ladder counts use only competencies that have an L1–L5 ladder (`hasLadder`). KCM-format competencies are counted separately. | Otherwise every KCM row shows up as an "incomplete ladder". |

---

## 3. Cadre family

`cadreFamily(ctx.cadre || model.position || model.title)` turns on the cadre-specific rules. The checks are applied in this order:

| Family | Pattern |
|---|---|
| `asha` | `/asha/i` |
| `anm` | `/\banm\b\|auxiliary nurse\|multi[- ]?purpose\|\bmpw\b\|\blhv\b\|lady health/i` |
| `cho` | `/\bcho\b\|community health officer\|mid[- ]?level/i` |
| `nurse` | `/nurse\|nursing\|\bgnm\b/i` |
| none | anything else |

**Frontline families** are `asha`, `anm`, `cho` and `nurse`. Several rules below run only for frontline families: the scope rules, the L3 and L4–L5 ladder rules, the area coverage, the KCM relevance check, the above-the-post check, and the device-law check.

---

## 4. Rule-based checks

Every finding has the shape `{check, sev, title, detail, refs[], fix, source:"computed"}`.

Severities: **B** = Blocker, **M** = Major, **m** = Minor.

Checks: `bloom`, `structure`, `ladder`, `context`, `coverage`.

### 4.1 Bloom's verbs

`BANNED = /^(understand|understands|understanding|know|knows|knowing|knowledge of|has knowledge|learn|learns|is aware|aware|appreciate|appreciates|is familiar|familiar|realis|realiz|comprehend)/i`. r3 adds `knowledge of` and `has knowledge`.

Strip leading `- • * 1. )` before testing the first word.

| Rule | Severity |
|---|---|
| Level labels starting with a BANNED verb, counted per level. Add "Levels 1 and 2 barely differ" when both are affected. | M if the worst level covers 25% or more of laddered competencies, otherwise m |
| Only indicators affected | m |

### 4.2 FRAC structure

| Rule | Severity |
|---|---|
| No Role–Activity sheet | M |
| Activities starting with a syllabus verb (`describe\|explain\|list\|enumerate\|define\|understand\|know\|state\|discuss`) | M if 30% or more, otherwise m |
| No competency is typed | M |
| No Behavioural or no Functional competencies | M |
| Role with fewer than 2 activities | m |
| **Competencies are too broadly defined** (see 4.2.1) | M if parts a–d hit; m if only part e |
| Tagged Domain, but the label matches `DOMAIN_LOOKS_KCM` | m |
| Frontline only: KCM competencies the post does not demand (label matches `KCM_FUNCTIONAL_NOT_FRONTLINE`) | m |

**4.2.1 "Competencies are too broadly defined"** is one finding that collects every way a Domain competency is too broad to assess. It opens with *"{n} of {N} Domain competencies are too broad to assess as one job capability."* and then lists:

- **(a) Catch-all labels.** The label names a whole field, not one job capability.
  `CATCH_ALL = /^(clinical|nursing|medical|basic|general|core|technical|public health)\s+(skills?|care|practices?|procedures?|knowledge)\b|protocols?\s*(&|and)\s*guidelines|^(knowledge of\s+)?(health\s+)?(programmes?|programs?|schemes?|guidelines|policies)\b/i`
  Examples: "Clinical Skills", "Knowledge of RMNCH+A protocols & guidelines".
- **(b) Broad competencies that repeat more specific ones.**
  - Tag each Domain competency with the clinical `AREAS` (section 5) that its label + description match.
  - Flag it if it spans 3 or more areas **and** shares an area with 2 or more other competencies.
  - Only clinical areas count here. Cross-cutting areas such as records, counselling, community, legal, IPC, medication and ward management are excluded, because they appear everywhere.
  - A FRAC with several narrow competencies in one area (e.g. Essential Newborn Care, Neonatal Resuscitation and LBW care) is good design and must **not** be flagged.
- **(c) Lists of programmes or schemes.** The label matches `/^(knowledge of\s+)?(the\s+)?(various\s+)?(national|state)[\w\s\/&,.+-]*\b(programmes?|programs?|schemes?|policies)\b/i`. Example: "National Health Programs".
- **(d) Frontline only: pitched above the post.** The label or description is about the district or state system rather than the worker's own job.
  `ABOVE_POST = /\b(district|state|national)\s+(health\s+)?(organi[sz]ation|system|administration|planning|management|functioning)\b|\bhealth (system|organi[sz]ation) (and|&) functioning\b/i`
- **(e) Topic definitions.** The description starts with "Knowledge of", "Understanding of" or "Awareness of" (`/^(knowledge|understanding|awareness) (of|and understanding of)/i`).

**Fix text (fixed):** define each competency as one job capability that can be observed and assessed, e.g. "Conducts ANC contacts to protocol and refers high-risk pregnancies". Then:
- drop catch-all competencies and share their content out to the specific ones;
- give each job area one home competency;
- fold scheme lists into the competencies where each scheme is used;
- narrow district or state content to what the worker does in that system.

**Other patterns used in 4.2:**
- `DOMAIN_LOOKS_KCM = /knowledge sharing|communication|team ?work|leadership|coordination|community (engagement|mobili[sz]ation)|data (management|analysis|use)|planning|stakeholder|documentation|record keeping/i`
- `KCM_FUNCTIONAL_NOT_FRONTLINE = /policy architecture|financial management|procurement|administration matters|budget\w*|legislat\w*|contract management|vendor/i`

### 4.3 Level ladder

| Rule | Severity |
|---|---|
| Laddered competencies with fewer than 5 level labels | M if more than 10%, otherwise m |
| KCM-format competencies with no L1–L5 job ladder | M |
| The same L5 label on 3 or more competencies | M, one finding per label |
| The same label at two levels of one competency | m |
| **"Level ladders are shifted upward"** (`LADDER_RULES` below) | M, one finding |

**`LADDER_RULES`.** Each rule is tested on `label + desc` of the given levels.

| # | Levels | Pattern | Message | Applies to |
|---|---|---|---|---|
| 1 | L1, L2 | `/\bindependent(ly)?\b\|\bwithout supervision\b/i` | L1–L2 already say the worker acts independently | all cadres |
| 2 | L3 | `/\b(supervis(es\|ing)\|mentor\w*\|coach(es\|ing)?\|train(s\|ing)?\s+(other\|junior\|new\|ASHA\|AWW\|staff\|peer)\w*\|guides?\s+(junior\|other\|ASHA\|new)\w*)\b\|supervision\s+(of\|to)\s+(ASHA\|junior\|other\|new\|staff\|peer\|team)/i` | L3 includes supervising, mentoring or training others | frontline |
| 3 | L4, L5 | `/\b(polic(y\|ies)\|state[- ]?(level\|wide)\|national[- ](level\|benchmark\w*\|strateg\w*)\|research\|represent\w*\|district[- ]?(level\|wide))\b/i` | L4–L5 describe policy, research or district/state roles | frontline |

**Detail:** one line per rule that hit, with "{n} of {N} competencies (codes)", followed by a fixed note that the Karmayogi crosswalk then gives the wrong rating.

**Fix (fixed text):** re-anchor every ladder to:
- L1: states and recognises
- L2: performs with a supervisor present
- L3: performs alone to protocol
- L4: handles complications and variation within the cadre's scope, and decides on referral
- L5: mentors peers and ASHAs, and runs facility-level audits and quality improvement (e.g. NQAS checklists)

Remove policy, research and state-level work from every level.

### 4.4 Guidelines and context: scope

The scope check runs sentence by sentence over every competency definition and every level. A hit is recorded as `{code, level, quote}`. A rule's `allow` pattern, when present, is tested on the same sentence and clears the hit.

There is **one finding per act**:
- **Title:** "Beyond {cadre} scope: {act}"
- **Detail:** the codes with their levels, one quoted example, and what the cadre may do instead
- **Fix:** "Rewrite as 'Identifies…, gives the pre-referral care the {cadre} is authorised for, and refers', or tag the act 'verify' against the state {cadre} job description."

**ANM / MPW / LHV**

| Act | Pattern | Clears when | Sev | What the ANM may do instead |
|---|---|---|---|---|
| IV drug administration | `/(?<!(annexure\|stage\|grade\|class\|phase\|schedule\|level\|module\|part\|chapter\|type)\s)\b(IV\|I\.V\.)(?![-\w])\|intravenous/i` | `/refer\w*[^.;]{0,60}(access\|line\|cannula)\|(access\|line\|cannula)[^.;]{0,60}refer/i` | B | Under the SBA guidelines, start an IV line only to stabilise before referral (verify against the current module and state orders) |
| Managing complications or complicated deliveries | `/manag\w*\s+(the\s+\|of\s+)?(obstetric\s+\|labou?r\s+\|delivery\s+\|medication\s+)?(complications\|emergencies)\|complicated\s+(deliver\|labou?r\|cases)\w*\|high[- ]risk\s+(or\|and\|\/)\s+complicated/i` | | B | Identify complications, give the specified pre-referral care (e.g. oxytocin, MgSO4 loading dose, first-dose antibiotics, bimanual compression) and refer; definitive management is at the FRU |
| Curative management | `/curative/i` | | B | Screen, counsel, support adherence, dispense MO-prescribed refills, refer |
| Wound debridement | `/debrid\w*/i` | | B | First aid and aseptic dressing of minor wounds, recognise infection, refer |
| Independent management of severe cases | `/independent(ly)?\s+manag\w*\s+(of\s+)?(severe\|complex\|major\|serious)/i` | | B | Stabilise and refer |
| Advanced resuscitation | `/advanced\s+(resuscitation\|life support)\|intubat\w*/i` | | B | Basic newborn resuscitation (NSSK / Helping Babies Breathe), then refer |
| Unspecified emergency drugs | `/emergency\s+(meds\|medicines\|medications\|drugs)/i` | | B | Name only the drugs listed for ANM/SBA pre-referral use (verify the list) |
| Prescribing | `/\bprescrib(es\|ing)\b/i` | | B | Dispense per protocol or MO prescription |
| Operative or MTP procedures | `/\b(MVA\|manual vacuum aspiration\|dilatation and curettage\|caesarean\|c-section\|vacuum extraction\|forceps deliver\w*)\b/i` | | B | These are MO or specialist procedures |
| Insecticide spraying or larviciding | `/\bspray(ing\|s)?\b\|larvicid\w*\|fogging/i` | | M | RDT testing, treatment per NCVBDC drug policy, LLIN promotion, support for source reduction |

**ASHA**

| Act | Pattern | Clears when | Sev |
|---|---|---|---|
| Giving injections | `/\binject(s\|ion\|ions\|ing)?\b\|\bIM\b\|\bIV\b\|intravenous/i` | `/refer\w*\|motivat\w*\|mobili[sz]\w*\|accompan\w*/i` | B |
| Conducting deliveries | `/conduct\w*\s+(normal\s+\|home\s+)?deliver\w*/i` | | B |
| Prescribing | `/\bprescrib(es\|ing)\b/i` | | B |

There are no code scope rules yet for CHO or nurse. The AI checklist (section 6) covers those cadres. Adding these lists is an open item for the clinical team.

### 4.5 Guidelines and context: outdated terms (`OUTDATED`)

These are scanned over activities, competency definitions and all level text. There is one finding per pattern, listing up to 12 codes.

| Pattern | Sev | Correct to | Condition |
|---|---|---|---|
| `/lunac(y\|tic)\s+act\|lunatic\|lunacy/i` | B | Mental Healthcare Act 2017 | |
| `/mental health act,?\s*1987/i` | B | Mental Healthcare Act 2017 | |
| `/(ndps\|narco\w*\s+drugs?\s+and\s+psychotropic)[^.\n]{0,40}1965\|1965[^.\n]{0,12}ndps/i` | B | NDPS Act 1985 | |
| `/\bTT\b\|tetanus toxoid\|TT injection\|TT vaccine/` | M | Td (2018) | |
| `/\bRNTCP\b/` | m | NTEP (2020) | |
| `/\bNPCDCS\b/` | m | NP-NCD (2023) | |
| `/health (and\|&) wellness cent\|\bHWCs?\b\|AB-HWC/i` | m | Ayushman Arogya Mandir (2023) | |
| `/\bNVBDCP\b/` | m | NCVBDC | |
| `/\bMCTS\b/` | m | RCH portal (+ U-WIN) | |
| `/\bMTP Act,?\s*1971\b(?![^.]{0,40}2021)/i` | m | MTP (Amendment) Act 2021 | |
| `/\bNRT\b/` *(new)* | m | NSSK + Helping Babies Breathe | |
| `/\bRMNCH\s*\+\s*A\b/i` *(new)* | m | RMNCAH+N | |
| `/\bNRHM\b/` *(new)* | m | NHM | |
| `/\bVHNDs?\b\|village health (and\|&) nutrition days?/i` *(new)* | m | VHSND | |
| `/\b(five\|5) rights\b/i` *(new)* | m | the current, expanded rights of medication administration | |
| `/partograph/i` *(new)* | m | add the WHO Labour Care Guide | only if `/labou?r care guide\|\bLCG\b/i` appears nowhere in the file |
| `/\bISO\s?\d{3,5}\|drugs? (and\|&) cosmetics act\|medical devices? (rules\|act\|law)/i` *(new)* | m | BMW Rules 2016 (as amended), Kayakalp/NQAS | frontline only |

### 4.6 Coverage

| Rule | Severity |
|---|---|
| A Role–Activity sheet exists but has no mapping column | m: "Activities are not mapped to competencies yet". Skip the next three rules. |
| Unmapped activities (quote the first 3) | M if 5% or more, otherwise m |
| Competencies no activity uses | m |
| Refs to codes that don't exist | M |
| Some (not all) activities have every posting blank | m |
| **"Core {cadre} areas with no dedicated competency"** | M |

For the last rule, take each area in `AREAS[family]` (section 5) and test it against all competency labels and descriptions joined together. Every area that matches nothing is missing. For each missing area, list the activities that match it, e.g. "Family planning (activities A12, A13, A14, A17 need it)".

---

## 5. Job-area lists (`AREAS`)

Each area is a name and a pattern, tested on the competency label and description. The ANM and CHO lists follow the **Ayushman Arogya Mandir CPHC service packages** plus the programmes the post runs.

| Key | Area | Pattern | ANM | CHO | Nurse | Clinical* |
|---|---|---|---|---|---|---|
| anc | Antenatal care | `/antenatal\|\bANC\b\|pregnan\|\bHRP\b\|birth (planning\|preparedness)/i` | ✓ | ✓ | ✓ | ✓ |
| intra | Intrapartum care and delivery | `/intrapartum\|deliver(y\|ies)\b\|labou?r\b\|partograph/i` | ✓ | ✓ | ✓ | ✓ |
| pnc | Postnatal and newborn care | `/postnatal\|\bPNC\b\|newborn\|neonat\|HBNC\|HBYC/i` | ✓ | ✓ | ✓ | ✓ |
| imm | Immunisation | `/immuni[sz]\|vaccin\|\bUIP\b/i` | ✓ | ✓ | ✓ | ✓ |
| fp | Family planning | `/family planning\|contracept\|IUCD\|Antara\|Chhaya\|\bOCPs?\b\|condom\|spacing method/i` | ✓ | ✓ | ✓ | ✓ |
| child | Child health (IMNCI, diarrhoea, pneumonia) | `/IMNCI\|diarrh\|pneumonia\|\bORS\b\|zinc\|child health\|IDCF\|paediatric\|pediatric\|sick (young )?(infant\|child)/i` | ✓ | ✓ | ✓ | ✓ |
| nutr | Nutrition and anaemia | `/nutrition\|anaemi\|anemi\|\bIFA\b\|growth monitor\|\bSAM\b\|malnutri/i` | ✓ | ✓ | ✓ | ✓ |
| adol | Adolescent health (RKSK) | `/adolescen\|RKSK\|WIFS\|menstrual/i` | ✓ | ✓ | ✓ | ✓ |
| ncd | NCD and common cancer screening | `/\bNCDs?\b\|non-communicable\|hypertension\|diabet\|cancer\|NP-NCD\|NPCDCS/i` | ✓ | ✓ | ✓ | ✓ |
| cd | TB and vector-borne disease | `/tubercul\|\bTB\b\|NTEP\|RNTCP\|malaria\|dengue\|vector\|NCVBDC\|NVBDCP/i` | ✓ | ✓ | ✓ | ✓ |
| ipc | Infection prevention and biomedical waste | `/infection (prevention\|control)\|bio-?medical\|\bBMW\b\|waste/i` | ✓ | ✓ | ✓ | |
| mh | Mental health and substance use | `/mental health\|psychiatr\|depress\|substance\|tobacco cessation\|alcohol\|Tele-?MANAS/i` | ✓ | ✓ | ✓ | ✓ |
| eld | Elderly and palliative care | `/elderly\|geriatr\|older (people\|persons\|adults)\|palliat\|end[- ]of[- ]life/i` | ✓ | ✓ | ✓ | ✓ |
| emer | Emergency first aid, burns and trauma | `/emergenc\|first aid\|burns?\b\|trauma\|injur\|\bBLS\b\|basic life support\|\bCPR\b\|snake ?bite\|poison/i` | ✓ | ✓ | ✓ | ✓ |
| eyeoral | Eye, ENT and oral health | `/vision\|cataract\|refractive\|ophthalm\|\bENT\b\|hearing\|oral health\|dental\|oral (hygiene\|cancer)/i` | ✓ | ✓ | | ✓ |
| minor | Common illnesses and minor ailments | `/minor ailment\|common (illness\|ailment)\|fever\|acute simple illness/i` | ✓ | ✓ | | ✓ |
| rec | Records and digital reporting (RCH portal, U-WIN) | `/record\|register\|report\|RCH portal\|U-WIN\|HMIS\|digital/i` | ✓ | ✓ | ✓ | |
| couns | Counselling and respectful care | `/counsel\|respectful\|SUMAN\|dignity\|privacy/i` | ✓ | ✓ | ✓ | |
| comm | Community engagement (VHSND, VHSNC, ASHA support) | `/VHSN\|VHND\|VHSNC\|community\|ASHA\|Jan Arogya Samiti/i` | ✓ | ✓ | | |
| med | Medication administration and safety | `/medication\|drug administration\|administ\w* (of )?(drugs\|medicines)\|pharmacolog\|injectab\|fluid therapy/i` | | ✓ | ✓ | |
| ward | Ward management and supervision | `/ward management\|manag\w* (the )?(ward\|unit)\|supervis\|leadership\|team management\|roster/i` | | | ✓ | |
| qual | Patient safety and quality (NQAS, Kayakalp) | `/patient safety\|quality\|NQAS\|LaQshya\|Kayakalp\|MusQan/i` | | | ✓ | |
| legal | Legal and ethical practice | `/legal\|ethic\|consent\|medico[- ]legal\|\bMLC\b\|POCSO\|PCPNDT\|MTP/i` | ✓ | ✓ | ✓ | |

\* **Clinical** = counts for the broad/overlap test in 4.2.1 (b).

**ASHA list**

| Area | Pattern |
|---|---|
| Maternal care | `/antenatal\|\bANC\b\|pregnan\|postnatal\|\bPNC\b/i` |
| Newborn and child care (HBNC/HBYC) | `/newborn\|neonat\|HBNC\|HBYC\|child/i` |
| Immunisation mobilisation | `/immuni[sz]\|vaccin/i` |
| Family planning | `/family planning\|contracept\|condom\|spacing/i` |
| Nutrition | `/nutrition\|anaemi\|anemi\|\bIFA\b\|malnutri/i` |
| Communicable disease | `/tubercul\|\bTB\b\|malaria\|dengue\|vector/i` |
| NCD screening support | `/\bNCDs?\b\|non-communicable\|CBAC\|hypertension\|diabet/i` |
| Mental health and elderly care | `/mental\|elderly\|palliat/i` |

---

## 6. AI judgement: fixed checklist only

The LLM never writes titles, severities, fixes, the verdict or the summary.

### 6.1 Per-competency call

- **Scope of the call:** laddered competencies only, 6 per call, 3 calls in parallel, complex tier.
- **Persona:** Vidya, a clinical and programme expert for Indian frontline health.
- **Code checks named in the prompt (do not flag):** measurable verbs; ladder shape (independent at L2; supervising, mentoring or training at L3; policy, research, district or state roles at L4–L5); overlap and tagging; and the outdated terms in 4.5. The prompt also gives the exact scope hits already found for those competencies, with "do NOT repeat".
- **The same two questions, asked for every competency:**
  - **Q1 Scope:** does any sentence give the cadre a clinical or public-health act outside its authorised scope (per the job description, the SBA guidelines and national programme guidelines)? Taught in the curriculum is not the same as authorised.
  - **Q2 Accuracy:** does any sentence state a drug, dose, schedule, cut-off, protocol, law or programme fact that is wrong or outdated for India today?
- **Rules given in the prompt:** flag only what you are sure of. Every flag copies 6–25 consecutive words exactly into `quote`. An empty list is a good answer.

```json
{"items":[{"code":"","scope":[{"quote":"","act":"","basis":""}],"accuracy":[{"quote":"","issue":"","correct":""}]}]}
```

### 6.2 State call

This call runs only when the state is set and is not national. It asks one question.

- **Q3 State fit:** what is the FRAC missing that is specific to the state?
- **Categories:** use only these five: Disease burden, Delivery and referral, Language and culture, State schemes, Geography and access.
- **Limits:** at most 6 items, and mark anything uncertain "(verify)".

```json
{"items":[{"category":"","item":"one sentence","refs":["codes"]}]}
```

### 6.3 Verification in code (what makes this repeatable)

1. **Quote check.** Normalise both texts: lowercase, strip quotes, turn dashes into spaces, drop other punctuation, collapse whitespace. The quote must be at least 4 words and must appear in that competency's definition or level text. If it doesn't, drop the flag.
2. **Rule overlap.** Drop the flag if its quote matches an `OUTDATED` pattern or ladder rule 2 or 3.
3. **Scope duplicates.** Drop an AI scope flag if a code scope rule already hit the same competency at the same level.
4. **State items.** Keep only the five categories, cap at 6, and sort by category order, then text.

### 6.4 Merge into at most three findings

All three have fixed titles and `source:"agent"`. Items inside each are sorted by code, then level.

| Title | Sev | Content |
|---|---|---|
| Other acts beyond {cadre} scope | B | `code level: "quote" — act; basis` |
| Clinical or programme facts to correct | M | `code level: "quote" — issue`; the fix lists the corrections |
| Does not reflect {state} | m | `category: item` |

---

## 7. Verdict, triage, summary and strengths (computed)

**Finding order:** severity (B → M → m), then check order (bloom, structure, ladder, context, coverage), then rule-based before AI.

**Triage:**
- **rebuild** if any of these hold:
  - the finding "Activities read as syllabus outcomes" is raised;
  - the finding "Competency type is missing" is raised;
  - more than half of the laddered competencies have incomplete ladders.
- **revise** if there is any Blocker, or 3 or more Majors.
- **use** otherwise.

**Verdict:** `"{Rebuild from the job before use | Revise before use | Usable with minor edits} — {nB} blockers, {nM} major and {nm} minor findings. Fix first: {n} kinds of act beyond {cadre} scope; {next B/M title}; {next B/M title}."`

**Summary:** what was checked: counts, the D/F/B split, the cadre and the state. Then: "{n} findings come from rule-based checks and are the same on every run; {n} come from AI judgement on a fixed checklist, each backed by a quote from the file."

**Strengths:** the core areas covered, then each check with no findings, as "{check}: no issues found".

**Per-check status:** the worst severity among that check's findings. B is "Fix before use", M is "Needs work", m is "Mostly fine", and none is "Pass".

---

## 8. Labels in the UI and in Excel

- **Findings list:** each finding shows either "rule-based check" or "AI judgement · quoted from the file".
- **Report header:** "{n} rule-based findings (the same on every run) · {n} AI judgement, each backed by a quote".
- **Excel, Review sheet and Expert check sheet:**
  - Add a **Method** row after Summary: "Rule-based checks give the same result on every run. AI judgement covers only a fixed checklist (scope, clinical accuracy, state fit), and each AI finding quotes the file. Review engine {version} · file fingerprint {first 12 characters}."
  - **Found by** is "Rule-based check" or "AI judgement (quoted)".
  - Never put internal agent names (Kaushal, Vidya) in files that go to experts.

---

## 9. Same file, same review

- **Fingerprint:** `sha256(JSON.stringify({v: ENGINE_VERSION, postings: model.postingLabels, roles: model.roles, competencies: model.competencies, ctx: {cadre, state, notes}}))`, first 40 hex characters.
- **Before running a review:** if a stored review has this fingerprint, return it with `fromCache: true`. The UI then says: *"This file and context were reviewed on {date}. The saved review is shown, so running it again gives the same answer."*, with a **Run a fresh review** link.
- **A fresh run** calls the model again and replaces the stored review. In the prototype, this passes `cache: {gcTime: 24h, refresh: true}` to `sample`.
- **Production:** store reports keyed by fingerprint in Postgres. Use **temperature 0** for the Reviewer calls. Temperature 0 alone is not fully deterministic; the fingerprint store is what guarantees the same answer.
- **Version bumps:** a new `ENGINE_VERSION` changes every fingerprint, so old reviews are not reused after the rules change.

---

## 10. Acceptance tests

Test fixtures are available from Sarvesh:
- `[Shared with Aastrika] GO-HRM Meghalaya (ANM FRAC).xlsx`
- `ANM competencies.xlsx` (Bihar)
- `GNM COMPETENCY DICTIONARY 9 June 2025.xlsx` (openpyxl cannot read its stylesheet; use a tolerant reader)

### 10.1 Meghalaya ANM FRAC, state Meghalaya

The rule-based checks must give the following. There are 28 rule-based findings in total.

**Parsing and structure**
- 31 competencies (17 Domain, 6 Functional, 8 Behavioural), 11 roles and 58 activities.
- No "lopsided mix" finding.
- "Activities are not mapped to competencies yet" (m).

**Breadth and ladders**
- **"Competencies are too broadly defined" (M):** 7 of 17. Catch-all labels: D9 and D56. Broad: D47, D52, D53 and D56. Scheme list: D40. Above the post: D29. 13 topic definitions.
- "Functional and Behavioural competencies have no job ladder" (M): 14 competencies.
- "Level ladders are shifted upward" (M): L1–L2 in 4 of 17, L3 in 15 of 17, and L4–L5 in 17 of 17.

**Coverage**
- "Core ANM areas with no dedicated competency" (M): family planning, child health, mental health, elderly and palliative care, and minor ailments.

**Scope and outdated terms**
- Scope Blockers:
  - IV drug administration (D44)
  - complications (D47, D52, D53)
  - curative management (D42, D43)
  - debridement (D46)
  - severe cases (D46)
  - advanced resuscitation and emergency drugs (D47)
- Spraying (D3): Major.
- Outdated terms: TT, RNTCP, NPCDCS, HWC, NVBDCP, NRT, RMNCH+A, VHND, Five Rights, partograph without LCG, and ISO/device law.

**Verdict and triage**
- Triage = **revise**.

### 10.2 Bihar ANM

- **Missing areas:** NCD screening, TB and vector-borne disease, mental health, eye/ENT/oral health, and legal and ethical practice.
- **Breadth:** C37 "National Health Programs" is flagged.
- **Separate newborn competencies are not flagged as overlap:** C7, C10, C11 and C13.

### 10.3 GNM

**Rule-based findings from r1 (must still appear)**
- Repealed laws (3 Blockers, ME70).
- 16 unmapped activities.
- 12 incomplete ladders.
- 113 of 136 activities read as syllabus outcomes.
- Competency type missing.
- Triage = **rebuild**.

**New in r3**
- Missing areas: adolescent health, NCD screening, TB and vector-borne disease, records, ward management, and patient safety and quality.

### 10.4 Repeatability (CI test, must pass before release)

Run the same file 3 times with the cache bypassed. The test passes when all three of these hold:
- All rule-based findings are identical word for word.
- Triage and verdict are identical.
- The AI findings keep the same titles (their content may vary).

---

## 11. Open items

1. **Code scope lists for CHO and Staff Nurse.** These need the clinical team; today the AI checklist covers those cadres.
2. **State rule packs.** Optional: e.g. Meghalaya malaria RDT/ACT, MHIS, maternity waiting homes. These could turn the state-fit AI question into a fixed rule.
3. **A cadre-subject rule for GNM-style dictionaries.** Labels such as "Psychology" or "English" are subjects; today they are caught only by the syllabus-activity rule.
4. **Confirm the r3 repeatability numbers with Claude.** They were measured with Gemini as a stand-in.
