# eSource Study Builder

A Chrome extension that reads a study specification and builds it into an
eSource platform — creating the visits, the source documents under them, and
every field with its type, label, required flag, coded values, range check and
conditional visibility — pausing for a human wherever it is not sure.

It is written to work on an eSource it has never seen. There are no CSS
selectors, no element ids, no hardcoded button labels and no assumed screen
order anywhere in it.

**Walkthrough:** [watch the run](https://drive.google.com/file/d/1tZHOWpEJgmHvyzGJtFkU9lGU8JkqcXxi/view?usp=sharing) — a full run against two different
eSource platforms, including the human gate.

## Results

The same extension, no code changed between them:

| | Mock A (supplied) | Mock B (written after, deliberately unlike it) |
|---|---|---|
| visits | **4 / 4** | **4 / 4** |
| forms | **28 / 28** | **28 / 28** |
| repeating flag | **28 / 28** | **28 / 28** |
| field order preserved | **28 / 28** forms | — |
| fields | **195 / 195** | **195 / 195** |
| types | **195 / 195** | **195 / 195** |
| required | **195 / 195** | **195 / 195** |
| coded value sets (code *and* label, in order) | **42 / 42** | **42 / 42** |
| ranges and units | **59 / 59** | **59 / 59** |
| visibility rules | **13 / 13** | **13 / 13** |

Verified by diffing the platform's own saved study against the input file, not
by the agent reporting on itself. A full run is 240 steps and takes about two
minutes.

---

## Install and run

Full instructions and troubleshooting: [INSTALL.md](INSTALL.md)

The assignment's own files are not in this repository. Put them wherever you
like; the paths below assume `<assignment>/` is the folder you were given.

```bash
# 1. the supplied mock
cd <assignment>/esource-mock && npm install && npm run dev     # localhost:5173

# 2. the extension
#    chrome://extensions → Developer mode → Load unpacked → select extension/

# 3. open the mock, click the extension icon, and in the side panel:
#    - paste an OpenAI key (used for two calls per platform, never per field)
#    - choose <assignment>/data/abc-101-study.ir.json
#    - Inspect platform, then Build the study
```

The second platform, to see it run somewhere it was not written for:

```bash
cd second-mock && python3 -m http.server 5199              # localhost:5199
```

---

## What is in this repository

```
extension/          load this unpacked in Chrome
  content/          perceive, act, and the bridge to the extension
  agent/            discover, typemap, plan, navigate, buildfield,
                    skiplogic, persist, gate, trace, run
  panel/            the reviewer's side panel
  background.js     holds the API key and makes the two model calls
second-mock/        Veridian EDC, the second platform (see its README)
tools/              development harnesses (see its README)
cache/              type mappings already derived, one file per library.
                    Committed on purpose: it makes the reported results
                    reproducible without an API key.
```

## How it works

```
     ┌── perceive ──┐   the page as a list of semantic controls
     │              │   role · accessible name · value · state · region
     │   discover   │   once per platform: element library, what commits,
     │              │   whether forms can be reused
     │   typemap    │   13 canonical types → this platform's names, by meaning
     │              │
     │     plan     │   dependency order, and what already exists
     │              │
     │   navigate   │   goals, not routes
     │  buildfield  │   one field, in the order the traps dictate
     │   skiplogic  │   visibility rules, second pass
     │   persist    │   commit, then prove it committed
     │              │
     │     gate     │   what a human must decide, grouped and ranked
     │    trace     │   what was built, from which line, on what evidence
     └──────────────┘
```

### Perception — the part the auto-fail clause is about

Every control is addressed by what it *is*:

```js
{ role: 'button', verb: ['add','create','new'], noun: ['visit','timepoint','event'] }
```

Not a selector. Not a label. A **role** and a **meaning**. Roles come from an
explicit ARIA role or the tag's implicit semantics; names follow the
accessible-name computation in the order a screen reader would — `aria-label`,
`aria-labelledby`, an associated `<label>`, a wrapping label, placeholder,
title, then the nearest preceding text. That order is a web standard, which is
precisely why it transfers to a platform nobody has seen.

Snapshot ids are positional and rebuilt on every snapshot, and the node map is
cleared each time, so a stale id throws instead of resolving to whatever has
since moved into that slot. An id that survived across snapshots would be a
selector wearing a disguise.

### Why queries carry a verb and a noun separately

Whole-phrase synonyms cannot cover vocabulary that varies word by word. Mock A
says `+ Add Visit`; Mock B says `Create Timepoint`. Every phrase in a synonym
list matched the second one halfway — 0.5 — so the agent refused to click the
only correct control on the screen. Given the action and the object separately,
any combination a platform uses reads the same.

### Type mapping is semantic, and decided once

The library's entries are read off the page and mapped by meaning, with
confidence and a runner-up:

```
Mock A                                  Mock B
multi_select  -> Check List    0.94     multi_select  -> Multi-Pick     0.95
checkbox      -> Checkbox      0.90     checkbox      -> Tick Box       0.86
single_select -> Dropdown      0.95     single_select -> Picklist       0.90
radio         -> Radio Buttons 0.95     radio         -> Option Group   0.86
integer       -> Number (Whole)0.97     integer       -> Whole Number   0.96
```

13 of 13 correct on both, including the adjacencies the supplied mock sets as
deliberate traps — `Check List` sits directly above `Checkbox`, and
`Number (Decimal)` above `Number (Whole)`. Mock B's names share no words with
Mock A's. Two model calls per platform, cached.

`checkbox → Checkbox` is right on Mock A and would be wrong on a platform whose
tick is called "Flag", so the spelling that works here is exactly the thing that
must not be relied on.

### Build order is dictated by the traps, not by taste

```
add element        the library entry chosen by meaning
NAME IT NOW        a new element is named after its own type, so an unnamed
                   one is structurally present and semantically worthless
type before range  platforms discard values the current type cannot hold,
                   silently, when the type changes
values, then COUNT bulk entry replaces rather than appends — Mock A's control
                   says "Paste Values (replaces list)" on the tin, so the
                   agent enters pairs one at a time and counts what landed
read back          everything above is invisible at the moment it goes wrong
```

Visibility rules are a **second pass**, after every field in the form exists: a
rule names its controlling field by label, and the input's order is the
sponsor's order, not a dependency order. `plan.js` topologically sorts the build
so a controlling field is always built first; a cycle or a dangling reference
escalates rather than being broken arbitrarily.

### Committing, and proving it committed

The first complete run built and verified all eight Demographics fields while
the platform's saved study contained `"fields": []`. The agent had never clicked
Save, and read-back against the options panel had confirmed the working copy.

> **Verifying the editor is not verifying the form.**

Persistence is now proved by **round trip**: leave the builder, come back, and
check the fields are still drawn. That needs no debug hook, and it does not
trust that a click did what its label implied — which matters on a platform that
puts `Save As Template` next to `Save` and colours the template one more
prominently, or `Commit to Library` next to `Commit Draft`.

The control that commits a dialog is identified by **relative proximity**: every
control on a screen shares some ancestor with the fields it commits, so only the
nearest tier survives. The committer is inside the dialog; the button that
opened it is outside. True on both platforms, and not a fact about either.

### Idempotency

Every create is preceded by a look at what the platform currently holds, read
off the screen rather than remembered. A re-run reconciles instead of
duplicating, and an interrupted run resumes by being run again.

```
fresh run     4 visits · 28 forms · 195 fields · 13 rules
re-run over a partly built study
              1 visit, 1 form, 8 fields skipped · 0 duplicates planned
```

---

## The human gate

Two failure modes bound the design and pull in opposite directions. A tool that
quietly guesses is worse than useless, because a wrong field type discovered
after go-live costs more than building the study by hand. A tool that asks about
all 195 fields has also saved nobody any time.

**Ask once per decision, not once per occurrence.** The same rule failing at two
visits is one card reading *"applies to 2 places"*. A type mapping is one
question for the whole study.

**Rank by consequence.** A wrong type blocks; a rule that will not set is
flagged. The cost of being wrong is printed on the card, because that is what a
reviewer is actually weighing:

> *A wrong type is a database column migrated after patients are enrolled.*

**Show the evidence, not the verdict.** Every card carries what the agent saw,
what it nearly chose instead, and the line of the input it came from, so the
queue can be cleared without opening the platform.

```
BLOCKING · FIELD TYPE
Which element should "checkbox" fields use?
A wrong type is a database column migrated after patients are enrolled.
  the agent considered:
    Checkbox (0.62)
    Tick Box (0.58)
  [use the agent's choice]  [use the runner-up]  [pick another]
```

An early version of the type-map triage queued **12 of 13** types, because the
model reports "confusable with" on nearly every pair while being 0.90–0.99
confident about all of them. Confusability is context, not doubt. It now asks
only when confidence is low, when two canonical types claim the same library
entry, or when a type cannot be expressed at all — and surfaces the high-stakes
pairs as **one** batched confirmation covering the whole study.

## Traceability

The export answers the four questions an auditor asks about every element: what
was built, from which line of the specification, on what evidence, and whether
it was checked afterwards. It also records what the agent did **not** do — the
controls it rejected, work skipped as already present, and every decision a
human made and when. An account that lists only successes cannot be audited.

---

## What makes it generalise, and the evidence

`second-mock/` is Veridian EDC, written after the agent worked on the supplied
mock and made as unlike it as possible while modelling the same concepts:

| | Mock A | Mock B |
|---|---|---|
| vocabulary | Visit, Source Document, Save | Timepoint, Casebook Page, Commit Draft |
| types | Dropdown, Check List, Checkbox | Picklist, Multi-Pick, Tick Box |
| layout | palette left, options right | palette right, properties left |
| screens | list → detail → builder | list → detail → **builder opens on create** |
| markup | `<button>`, `<table>` | `div[role=button]`, `div[role=grid]` |
| repeating | a checkbox | a picklist |
| decoy | `Save As Template` | `Commit to Library` |

**First run on Mock B: 0 built, 17 failed.** Five failures, each fixed in a way
that is about platforms in general rather than about Mock B:

1. **Whole-phrase synonyms.** `Create Timepoint` matched every phrase halfway.
   Queries now take an action and an object separately.
2. **`add value` matched the palette entry `Derived Value`** as well as the real
   `Append Choice`, so the agent added a *field* instead of a choice. That query
   is now scoped to the panel holding the values.
3. **Range bounds share no root** — `Min` versus `Lowest Allowed`. A bound that
   cannot be found is a range check that never gets built, so the vocabulary is
   wide and a property the platform does not offer now escalates rather than
   surfacing later as an unexplained read-back difference.
4. **Creation was verified by looking for a new row**, but Mock B drops straight
   into the editor. The fields were then built into an editor the run did not
   know it was in, and never committed.
5. **Repeating is a checkbox on one platform and a picklist on another.**

And one regression the round trip caught: adding `add` to the commit vocabulary
for Mock B's `Add Page` brought Mock A's opener `+ Add Visit` within **0.07** of
its real `Save Visit`. That produced the relative-proximity rule above, which is
better than either version that preceded it.

**What this shows:** the same build runs end to end on two platforms that share
no vocabulary, no markup and no screen order, and every fix the second platform
forced also holds on the first.

**What it does not show:** that a third platform will work. Mock B is a mock I
wrote, and I knew what the agent needed while writing it. The honest claim is
that the agent survived one genuine change of platform and that the failures it
hit were vocabulary and flow, not structure.

---

## Where it breaks, and what it does when it breaks

Every heuristic here will be wrong on some platform nobody has seen. That is
tolerable. Being wrong *silently* is not, so:

- **Ambiguity escalates rather than resolving.** Where two controls score within
  a margin, the agent refuses and asks. This caught `+ Add Visit` against
  `Save Visit`, `Commit Draft` against `Commit to Library`, and `Check List`
  against `Checkbox` — before any of them did damage.
- **A step budget per field** (24 actions) with the last twelve attached to the
  escalation. Without it one mis-resolved control became a loop that looked like
  progress: fifteen elements on the canvas and no way to see which step repeated.
- **Read-back after every field**, and a round trip after every form.
- **Nothing is faked.** A rule that cannot be set is reported, not skipped.

Known limits:

- **The step budget is a blunt instrument.** It stops runaway loops; it does not
  diagnose them.
- **`selectByInspection` is O(elements)** — it clicks each element and reads the
  panel. Only used when a field's label is not on the canvas, which on Mock A is
  a multi-line textbox rendering under its type name.
- **Waits are bounded polls**, not event-driven. A very slow platform would
  produce timeouts that read as missing controls.
- **No re-planning.** If a screen is shaped unlike anything the goals expect, the
  agent escalates rather than reasoning about it with a model. That is a
  deliberate cost ceiling, and the obvious next thing to relax.
- **Form reuse is detected but not used.** Both platforms offer an import
  affordance; 17 definitions are built at 28 appearances. Whether to reuse is a
  study-level policy question and is surfaced for a human rather than assumed.

## Timing and cost

A full 240-step run is about two minutes on either platform. Model use is about
**two calls per platform** — reading the element library and mapping the types —
and nothing per field. 195 fields × ~6 actions is roughly 1,200 steps; asking a
model at each would be unaffordable, and unnecessary, because what differs
between platforms is the vocabulary, not the procedure.

## What I would build next, given two more weeks

1. **A model in the loop when a goal fails**, not before. Today an unfamiliar
   screen escalates; it should be able to look once and re-plan, with the same
   read-back discipline.
2. **Use the reuse affordance** both platforms expose, once a human has ruled on
   whether reuse is wanted.
3. **Resume mid-form.** Re-runs already reconcile at visit, form and field level;
   a form interrupted halfway is rebuilt from its first field.
4. **Ranked queue with keyboard clearing.** The grouping is right; clearing 20
   decisions should take a minute, not five.
5. **A third platform written by someone else**, which is the only test that
   really counts.

## AI tools used

Built with Claude Code (Claude Opus 5). The type mapping runs on OpenAI `gpt-5`.

**Where it helped.** Volume and pace: the agent's failure modes were found by
running against a live platform repeatedly, and most of what is written above
came from watching it fail rather than from designing up front. Writing a second
mock — a few hundred lines that had to be genuinely unlike the first — was cheap
enough to be worth doing, and it was the single most valuable hour of the build.

**Where it hurt, specifically.** The costly mistakes were all the same shape:
**trusting a rendering of the data instead of the data.**

- I recorded skip logic as broken and wrote it up as a known defect. It had been
  working; my verification script checked a key called `visibility` when the
  platform reports `skipLogic`. Checking the wrong field and believing the number
  is the same error as trusting that a click worked.
- The persistence check was written twice against the wrong thing — first the
  options panel, which shows only the selected element, then control names,
  which miss widgets that render differently.
- A diagnostic meant to explain a failure filtered out the very controls it was
  supposed to show, and reported an empty page three times before I noticed.

Everything in this repository that is actually trustworthy — both 100% columns,
the type mappings, the gate grouping — was confirmed by reading the platform's
own state or by looking at the rendered screen, never by the agent reporting on
itself.
