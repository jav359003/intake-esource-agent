/**
 * Mapping canonical field types onto whatever this platform calls them.
 *
 * The assignment is explicit that this is semantic, not string matching, and
 * the mock proves why: its library lists "Check List" (a coded multi-select)
 * directly above "Checkbox" (a single tick). Those two are one row apart, look
 * almost identical, and mean different things. Meanwhile `checkbox` maps to
 * "Checkbox" here and would map to "Flag" or "Tick Box" elsewhere -- so the
 * spelling that works on this platform is exactly the thing that must not be
 * relied on.
 *
 * The mapping is decided ONCE per platform from the entries the agent actually
 * read off the page, then cached. Thirteen types is two model calls, not 195.
 *
 * Every mapping carries a confidence and a reason. Anything uncertain, and
 * every pair the model itself flags as confusable, goes to the human gate
 * BEFORE a single field is built with it -- because a wrong type is a database
 * column that has to be migrated after patients are enrolled in it.
 */

const CANONICAL = {
  text:          'Free text, one line.',
  textarea:      'Free text, several lines.',
  integer:       'A whole number. May carry a min, max and units.',
  decimal:       'A number with a fractional part. May carry a min, max and units.',
  date:          'A calendar date, no time of day.',
  time:          'A time of day, no date.',
  datetime:      'A date and a time together.',
  boolean:       'Yes or No. Exactly two states, not a coded list.',
  single_select: 'Choose exactly ONE option from a coded list. The choices are normally collapsed until opened.',
  multi_select:  'Choose ZERO OR MORE options from a coded list.',
  radio:         'Choose exactly ONE option from a coded list, with every choice visible at once.',
  checkbox:      'A SINGLE tick: on or off. NOT a list of choices.',
  calculated:    'Derived from other fields by a formula. Not entered by hand.',
};

const SYSTEM = `You map canonical clinical-data field types onto the element library of an
eSource platform you have never seen.

You are given the exact names the platform's library shows, read off the page.
Decide by MEANING. Names are unreliable: two entries may be one row apart with
nearly identical wording and completely different semantics, and the same
concept is called different things on different platforms.

The two pairs that are confused most often, and cost the most when confused:
  - a single tick (checkbox) versus a coded list of tick boxes (multi_select)
  - a collapsed one-of list (single_select) versus an always-visible one-of
    list (radio)

A wrong type is a database column that must be migrated after patients are
already enrolled in it. When two library entries are plausible for one
canonical type, say so and give both, rather than picking the likelier one.`;

function buildPrompt(libraryEntries) {
  const canon = Object.entries(CANONICAL)
    .map(([k, v]) => `  ${k}: ${v}`).join('\n');
  const lib = libraryEntries.map((e, i) => `  ${i}. ${e}`).join('\n');
  return `The platform's element library shows these entries, in the order they appear:

${lib}

Map each canonical type below onto exactly one library entry.

${canon}

Return ONLY a JSON object:

{
  "mappings": [
    {
      "canonical": "multi_select",
      "library_entry": "Check List",
      "confidence": 0.94,
      "reasoning": "one line saying why, in terms of meaning",
      "runner_up": "Checkbox",
      "confusable_with": ["checkbox"]
    }
  ],
  "unmapped": [
    {"canonical": "...", "why": "no entry in this library expresses it"}
  ],
  "notes": ["anything about this library worth telling a human"]
}

Rules:
- Every one of the 13 canonical types appears exactly once, in "mappings" or in
  "unmapped". Never silently omit one.
- "confidence" is 0 to 1. Be honest: an entry you are inferring from a name you
  do not recognise is not 0.9.
- "runner_up" is the second-best entry, or null. If the runner-up is close,
  the confidence must reflect that.
- "confusable_with" lists other canonical types that could plausibly claim this
  same library entry. This is what a human gets asked about.
- If a library entry is a plausible home for two canonical types, that is a
  fact worth reporting, not a tie to break silently.`;
}

/**
 * Split the mapping into what must be decided, what should be confirmed, and
 * what can just be used.
 *
 * The first version of this queued twelve of thirteen types, because the model
 * reports "confusable_with" on almost every pair -- date against date/time,
 * text against textarea -- while being 0.97 confident about all of them. That
 * is the same mistake the assignment warns about one level down: a tool that
 * makes the builder re-verify everything has saved nobody any time.
 *
 * Confusability is CONTEXT, not doubt. What actually warrants a human are:
 *   - low confidence, or a runner-up too close to call
 *   - two canonical types claiming the same library entry, which means one
 *     mapping is definitely wrong
 *   - a type the platform appears unable to express at all
 *
 * The high-stakes pairs the assignment names -- a tick versus a coded list, a
 * collapsed one-of versus a visible one-of -- are surfaced as ONE batched
 * confirmation card rather than a question each. One glance, one click, and it
 * covers every field of those types in the whole study.
 */
const HIGH_STAKES_PAIRS = [
  ['checkbox', 'multi_select'],
  ['single_select', 'radio'],
  ['integer', 'decimal'],
  ['boolean', 'checkbox'],
];

function triage(result, { floor = 0.85, margin = 0.1 } = {}) {
  const blocking = [];
  const byEntry = new Map();

  for (const m of result.mappings || []) {
    if (m.confidence < floor) {
      blocking.push({ ...m, why: `confidence ${m.confidence} is below the ${floor} bar`,
                      options: [m.library_entry, m.runner_up].filter(Boolean) });
    }
    const prior = byEntry.get(m.library_entry);
    if (prior) {
      blocking.push({ ...m, why: `"${m.library_entry}" is already mapped to ${prior}; one of the two is wrong`,
                      options: [m.library_entry, m.runner_up].filter(Boolean) });
    }
    byEntry.set(m.library_entry, m.canonical);
  }
  for (const u of result.unmapped || []) {
    blocking.push({ ...u, why: `this platform has no element for ${u.canonical}: ${u.why}`, options: [] });
  }

  // One card, covering every high-stakes pair the platform actually has.
  const mapped = Object.fromEntries((result.mappings || []).map((m) => [m.canonical, m]));
  const rows = [];
  for (const [a, b] of HIGH_STAKES_PAIRS) {
    if (mapped[a] && mapped[b] && mapped[a].library_entry !== mapped[b].library_entry) {
      rows.push({ pair: [a, b],
                  entries: [mapped[a].library_entry, mapped[b].library_entry],
                  reasoning: [mapped[a].reasoning, mapped[b].reasoning] });
    }
  }
  const confirm = rows.length
    ? [{ kind: 'type-map-confirmation', rows,
         why: 'These pairs are the ones most often mapped the wrong way round. '
            + 'Confirm once and it applies to every field of these types in the study.' }]
    : [];

  return { blocking, confirm, autoAccepted: (result.mappings || []).length - blocking.length };
}

/** Kept for callers that only want the blocking set. */
function needsReview(result, opts) {
  return triage(result, opts).blocking;
}

if (typeof window !== 'undefined') window.__soaTypemap = { CANONICAL, SYSTEM, buildPrompt, triage, needsReview, HIGH_STAKES_PAIRS };
if (typeof module !== 'undefined') module.exports = { CANONICAL, SYSTEM, buildPrompt, triage, needsReview, HIGH_STAKES_PAIRS };
