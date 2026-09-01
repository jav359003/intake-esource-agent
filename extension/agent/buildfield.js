/**
 * Build one field, then read it back.
 *
 * This is the unit the whole run replays 195 times, so its order is not a
 * style choice -- every step below exists because doing it in a different
 * order silently loses something the assignment grades:
 *
 *   1. add the element        the library entry decided by typemap, not by name
 *   2. NAME IT IMMEDIATELY    a new element defaults its label to the TYPE name,
 *                             so an unnamed element is structurally present and
 *                             semantically worthless
 *   3. type before range      platforms discard values the current type cannot
 *                             hold, silently, when the type changes. Setting a
 *                             range and then the type loses the range and says
 *                             nothing.
 *   4. coded values, then COUNT   bulk entry tends to replace rather than
 *                             append. This platform's control is literally
 *                             labelled "Paste Values (replaces list)".
 *   5. required flag
 *   6. read back and diff     everything above is invisible at the moment it
 *                             goes wrong; read-back is the only thing that
 *                             catches it
 *
 * Skip logic is deliberately NOT here. A rule references another field in the
 * same form by label, so it can only be set once that field exists -- it is a
 * second pass over the form, run by the planner.
 */
// Wrapped in its own scope: Chrome evaluates every content script in one
// shared world, so two files declaring `const sleep` at top level is a
// SyntaxError that kills both.
(function () {

const B = {};

/** Meanings, not this platform's wording. Every query is a list of synonyms. */
const Q = {
  typeSelect: { role: 'combobox', name: ['element type', 'type', 'field type', 'control type'] },
  // The FIELD's label, anchored to the field's own type control.
  //
  // Once a coded field has values, every value row contributes its own "Label"
  // input, and a bare name query picks one of those instead -- read-back on
  // "Sex at Birth" came back "Undisclosed", the last option's label. The
  // field-level properties cluster around the type selector while value rows
  // cluster with each other, so anchoring on the type control separates them
  // without knowing anything about this platform's markup.
  // The FIELD's label, explicitly not one belonging to a coded value.
  //
  // Every value row contributes its own "Label" input once a coded field has
  // values, and they are indistinguishable by name. What does distinguish them
  // is grouping: the values live in their own sub-panel. Excluding that
  // sub-panel is structural, not platform knowledge -- any builder that lets
  // you add coded values groups them somewhere.
  label:      { role: 'textbox', name: ['label', 'field label', 'caption', 'question text', 'title'],
                notRegion: ['values', 'choices', 'coded values'] },
  required:   { role: ['checkbox', 'switch'], name: ['required', 'mandatory', 'must be answered'] },
  // Range bounds are named a dozen ways and share no common root: "Min",
  // "Lowest Allowed", "Range From", "Floor". The list is wide on purpose --
  // a bound the agent cannot find is a range check that never gets built.
  min:        { role: ['textbox', 'spinbutton'],
                name: ['min', 'minimum', 'lowest', 'lowest allowed', 'lower limit',
                       'range from', 'least', 'floor', 'from'],
                notName: ['max', 'maximum', 'highest'] },
  max:        { role: ['textbox', 'spinbutton'],
                name: ['max', 'maximum', 'highest', 'highest allowed', 'upper limit',
                       'range to', 'greatest', 'ceiling', 'to'],
                notName: ['min', 'minimum', 'lowest'] },
  units:      { role: 'textbox', name: ['units', 'unit', 'uom', 'measure', 'measurement'] },
  formula:    { role: 'textbox', name: ['formula', 'expression', 'calculation', 'derivation'] },
  // Scoped to the sub-panel that holds the choices, and expressed as an
  // action plus an object.
  //
  // Unscoped, "add value" matched the palette entry "Derived Value" exactly as
  // well as the real control "Append Choice" -- both 0.5 -- and the agent
  // clicked the palette, adding a whole extra field to the form instead of a
  // choice to the list. A control that adds a coded value lives with the coded
  // values; nothing in the type palette does.
  addValue:   { role: 'button', verb: ['add', 'append', 'new', 'create', 'insert'],
                noun: ['value', 'choice', 'option', 'code', 'item'],
                name: ['add value', 'add option', 'add choice', 'append choice'],
                region: ['values', 'choices', 'codes', 'coded'],
                notName: ['paste', 'apply', 'remove', 'drop', 'delete'] },
  valueCode:  { role: 'textbox', name: ['code', 'stored value', 'value'],
                region: ['values', 'options list', 'choices', 'codes'] },
  valueLabel: { role: 'textbox', name: ['label', 'display', 'text'],
                region: ['values', 'options list', 'choices', 'codes'],
                notName: ['paste'] },
  // "Paste" style bulk entry is deliberately NOT used: it replaces the list.
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A budget per goal, so a confused agent burns twelve actions instead of
 * twelve hundred. Exceeding it is not a crash: it is an escalation carrying
 * the transcript, which is the only useful thing to hand a human at that
 * point. Without this, one mis-resolved control turns into a loop that looks
 * like progress from the outside -- fifteen elements on the canvas and no way
 * to tell which step was repeating.
 */
class Budget {
  constructor(limit, what) { this.limit = limit; this.used = 0; this.what = what; this.trail = []; }
  spend(action) {
    this.trail.push(action);
    if (++this.used > this.limit) {
      const e = new Error(`step budget exhausted building ${this.what}: ` +
                          `${this.used} actions, limit ${this.limit}`);
      e.overBudget = true;
      e.trail = this.trail.slice(-12);
      throw e;
    }
  }
}

/**
 * Add an element of a given library entry to the open form.
 * The library is found structurally -- a group of buttons whose names are the
 * library's entries -- not by a container class.
 */
B.addElement = async function addElement(libraryEntry, ctx) {
  const { act, log } = ctx;
  ctx.budget?.spend(`add-element ${libraryEntry}`);
  const hit = act.resolve({ role: 'button', name: libraryEntry, minScore: 0.9 });
  if (!hit.ok) return { ok: false, why: `no library control named "${libraryEntry}": ${hit.reason}` };
  if (!hit.confident) {
    return { ok: false, escalate: true,
             why: `"${libraryEntry}" matched ambiguously (margin ${hit.margin})`,
             candidates: hit.candidates.map((c) => c.name) };
  }
  act.click(hit.control.id);
  await sleep(ctx.settle);
  log('add-element', { libraryEntry, matched: hit.control.name });
  return { ok: true };
};

/** Set the options panel's simple text/toggle properties. */
B.setProperty = async function setProperty(query, value, ctx, { kind = 'fill' } = {}) {
  const { act } = ctx;
  ctx.budget?.spend(`set ${JSON.stringify(query.name).slice(0, 30)}`);
  const hit = act.resolve(query);
  if (!hit.ok) return { ok: false, why: hit.reason, missing: true };
  if (kind === 'fill') act.fill(hit.control.id, value);
  else if (kind === 'check') act.setChecked(hit.control.id, Boolean(value));
  else if (kind === 'choose') return act.choose(hit.control.id, value);
  await sleep(ctx.settle);
  return { ok: true, control: hit.control.name };
};

/**
 * Enter coded values one pair at a time, then count what actually landed.
 *
 * Codes and labels are different things -- the code is what the database
 * stores. Entering labels only produces a field that looks right and stores
 * the wrong thing, which is invisible until someone queries the data.
 */
B.setCodedValues = async function setCodedValues(options, ctx) {
  const { act, log, budget } = ctx;
  for (const opt of options) {
    budget?.spend(`add-value ${opt.code}`);
    const add = act.resolve(Q.addValue);
    if (!add.ok) return { ok: false, why: `no control to add a coded value: ${add.reason}` };
    act.click(add.control.id);
    await sleep(ctx.settle);

    // The new pair's inputs are the last ones on the page; anchor on the add
    // button so a form with other code/label fields elsewhere cannot capture us.
    // "The newest row" means the last one in DOCUMENT order. find() sorts by
    // score, so sorting by docIndex here is not a tidy-up -- reading the
    // score-ordered array positionally is what corrupted the field label.
    const byDoc = (xs) => [...xs].sort((a, b) => a.docIndex - b.docIndex);
    const codes = byDoc(act.find(Q.valueCode));
    const labels = byDoc(act.find(Q.valueLabel));
    const code = codes[codes.length - 1];
    const label = labels[labels.length - 1];
    if (!code || !label) return { ok: false, why: 'could not find the code and label inputs for a new value' };
    act.fill(code.id, opt.code);
    act.fill(label.id, opt.label);
    await sleep(ctx.settle);
  }
  // Read back the count. Bulk-entry shortcuts replace rather than append, and
  // a per-pair loop can still drop one if a click did not register.
  const got = act.find(Q.valueCode).length;
  log('coded-values', { wanted: options.length, got });
  if (got !== options.length) {
    return { ok: false, escalate: true,
             why: `entered ${options.length} coded values but ${got} are present afterwards` };
  }
  return { ok: true, count: got };
};

/**
 * Read the field back off the page and compare it against what was intended.
 * This is the step that catches every trap above, because all of them look
 * fine at the moment they happen.
 */
B.readBack = function readBack(field, ctx) {
  const { act } = ctx;
  const out = { diffs: [] };
  const check = (what, query, expected, get) => {
    const hit = act.resolve(query);
    if (!hit.ok) { out.diffs.push({ what, expected, actual: null, why: 'control not found on read-back' }); return; }
    const actual = get(hit.control);
    const same = String(actual ?? '').trim().toLowerCase() === String(expected ?? '').trim().toLowerCase();
    if (!same) out.diffs.push({ what, expected, actual });
  };

  check('label', Q.label, field.label, (c) => c.value);
  check('type', Q.typeSelect, ctx.libraryEntryFor(field.type), (c) => c.value);
  if (field.required !== undefined) {
    const hit = act.resolve(Q.required);
    if (hit.ok && Boolean(hit.control.state?.checked) !== Boolean(field.required)) {
      out.diffs.push({ what: 'required', expected: field.required, actual: Boolean(hit.control.state?.checked) });
    }
  }
  // Range is checked AFTER type on purpose: this is where a type set later
  // than the range shows up as an empty min/max.
  for (const [what, query, expected] of [['min', Q.min, field.min], ['max', Q.max, field.max],
                                         ['units', Q.units, field.units]]) {
    if (expected === undefined || expected === null) continue;
    check(what, query, expected, (c) => c.value);
  }
  if (field.options?.length) {
    const codes = act.find(Q.valueCode);
    if (codes.length !== field.options.length) {
      out.diffs.push({ what: 'coded values', expected: field.options.length, actual: codes.length });
    }
  }
  out.ok = out.diffs.length === 0;
  return out;
};

/** Build one field end to end, in the order the traps dictate. */
B.buildField = async function buildField(field, ctx) {
  ctx = { ...ctx, budget: new Budget(ctx.stepLimit ?? 24, `"${field.label}"`) };
  try {
    return await buildFieldInner(field, ctx);
  } catch (e) {
    if (e.overBudget) return { ok: false, escalate: true, why: e.message, trail: e.trail };
    return { ok: false, escalate: true, why: `unexpected failure: ${e.message}` };
  }
};

async function buildFieldInner(field, ctx) {
  const entry = ctx.libraryEntryFor(field.type);
  if (!entry) return { ok: false, escalate: true, why: `no library entry mapped for type "${field.type}"` };

  const added = await B.addElement(entry, ctx);
  if (!added.ok) return added;

  // 2. Name it immediately. A new element is named after its own type until
  //    told otherwise, and an element that exists but was never named is
  //    structurally present and semantically worthless.
  const named = await B.setProperty(Q.label, field.label, ctx);
  if (!named.ok) return { ok: false, escalate: true, why: `could not set the label: ${named.why}` };

  // 3. Type is already correct from the library choice. Setting range first
  //    and type second would lose the range, so range comes after.
  const notOffered = [];
  for (const [what, query, value] of [['min', Q.min, field.min], ['max', Q.max, field.max],
                                      ['units', Q.units, field.units],
                                      ['formula', Q.formula, field.formula]]) {
    if (value === undefined || value === null || value === '') continue;
    const r = await B.setProperty(query, value, ctx);
    if (!r.ok) notOffered.push(what);
  }
  if (notOffered.length) {
    return { ok: false, escalate: true,
             why: `this platform offers no control for ${notOffered.join(', ')} on a ` +
                  `"${entry}" field, so ${notOffered.length === 1 ? 'that value is' : 'those values are'} ` +
                  `not on the field`,
             notOffered };
  }

  if (field.options?.length) {
    const vals = await B.setCodedValues(field.options, ctx);
    if (!vals.ok) return vals;
  }
  if (field.required) await B.setProperty(Q.required, true, ctx, { kind: 'check' });

  // 6. Read back. Everything above is invisible at the moment it goes wrong.
  const verified = B.readBack(field, ctx);
  if (!verified.ok) {
    return { ok: false, escalate: true, why: 'read-back did not match what was intended',
             diffs: verified.diffs };
  }
  return { ok: true, entry, actions: ctx.budget.used };
}

B.Budget = Budget;
B.Q = Q;
if (typeof window !== 'undefined') window.__soaBuildField = B;
if (typeof module !== 'undefined') module.exports = B;

})();
