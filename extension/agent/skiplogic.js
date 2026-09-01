/**
 * Conditional visibility: "show this field only when that field holds this
 * value".
 *
 * Deliberately a SECOND pass over a form, after every field exists. A rule
 * names its controlling field by label, so setting it while building would
 * fail for any field whose controller comes later -- and the input's order is
 * the sponsor's order, not a dependency order. plan.js sorts the build so a
 * controller is always built first, and these rules run afterwards.
 *
 * Two things here are not obvious from the input file:
 *
 *   - to edit a field you must first SELECT it, which means finding it on the
 *     canvas rather than in the options panel. The panel shows whatever is
 *     selected, so writing to it without selecting first edits the wrong field.
 *   - the rule's value is a CODE for coded fields and the word Yes/No for
 *     booleans. Writing the human-readable label instead produces a rule that
 *     reads correctly and never fires.
 */

(function () {

const S = {};
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

const Q = {
  // Three concepts, named a dozen ways: whether the field is conditional,
  // which field governs it, and what that field must hold. Mock A calls them
  // Visibility / When / Value; Mock B calls them Display Rule / Governing
  // Field / Required Answer. Nothing but the concepts is shared.
  mode:      { role: 'combobox',
               name: ['visibility', 'conditional', 'display rule', 'show when', 'branching',
                      'display', 'shown'] },
  whenField: { role: 'combobox',
               name: ['when', 'controlling field', 'governing field', 'depends on',
                      'based on', 'source field', 'parent field'],
               notName: ['visibility', 'display rule', 'kind', 'type'] },
  whenValue: { role: ['textbox', 'combobox'],
               name: ['value', 'equals', 'condition value', 'when value', 'required answer',
                      'answer', 'expected'],
               notRegion: ['values', 'choices', 'coded'],
               notName: ['label', 'code'] },
};

/**
 * Select a field on the builder canvas by its label.
 *
 * The canvas draws each field as a control carrying its label; the options
 * panel then reflects whatever is selected. Anchoring on the canvas rather
 * than the panel is the difference between editing the field you meant and
 * editing whichever one happened to be open.
 */
/**
 * Find an element by selecting each in turn and reading what the panel says.
 *
 * Slower than matching a name, and correct when the name on the canvas is not
 * the label. The panel is the platform's own answer to "what is selected", so
 * this works wherever a builder has an inspector at all.
 */
S.selectByInspection = async function selectByInspection(label, ctx, { max = 40 } = {}) {
  const { act } = ctx;
  const want = String(label).trim().toLowerCase();
  const panelLabel = { role: 'textbox', name: ['label', 'caption', 'field label'],
                       notRegion: ['values', 'choices'] };

  const snap = window.__soaPerceive.snapshot();
  const candidates = snap.controls
    .filter((c) => ['textbox', 'combobox', 'checkbox', 'radio'].includes(c.role))
    .filter((c) => !c.region.some((r) => /option|propert|setting/i.test(r)))
    .filter((c) => !/^(find|filter|search)$/i.test(c.name || ''))
    .sort((a, b) => a.docIndex - b.docIndex)
    .slice(0, max);

  for (const c of candidates) {
    const node = window.__soaPerceive.nodeFor(c.id);
    if (!node) continue;                       // snapshot moved on; skip
    node.click();
    await nap(ctx.settle * 2);
    const shown = act.resolve(panelLabel);
    if (shown.ok && String(shown.control.value || '').trim().toLowerCase() === want) {
      return { ok: true, foundBy: 'inspection' };
    }
    // Re-snapshot each time: clicking changes the panel and invalidates ids.
    window.__soaPerceive.snapshot();
  }
  return { ok: false, why: `inspected ${candidates.length} elements and none is labelled "${label}"` };
};

S.selectElement = async function selectElement(label, ctx) {
  const { act } = ctx;
  const CONTAINER = new Set(['tablist', 'main', 'list', 'navigation', 'form', 'table', 'group', 'dialog']);
  const norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const want = norm(label);
  // Containers are excluded by role and by shape. A canvas wrapper's
  // accessible name is every field's label run together, so it matches any
  // label you search for -- and being the biggest thing on screen, a
  // "largest box wins" rule picked it every time. Clicking it selected
  // whichever element it happened to contain first: asking for "Resolution
  // Date" opened "Date", and seven of thirteen rules landed on the wrong
  // field before the panel read-back caught it.
  // Look repeatedly rather than once. Standalone, this selector finds the
  // field every time; inside a run it failed on four fields whose forms had
  // just been re-opened, and those same pages contained the field when
  // inspected a moment later. "Not there yet" and "not there" are different
  // answers and only one of them should escalate.
  const look = () => act.find({ role: ['button', 'listitem', 'row', 'tab', 'textbox',
                                       'checkbox', 'radio', 'combobox'],
                                name: label, minScore: 0.8 })
    .filter((c) => !CONTAINER.has(c.role))
    .filter((c) => !c.region.some((r) => /option|propert|setting/i.test(r)))
    .filter((c) => norm(c.name).startsWith(want));

  await window.__soaNavigate.waitFor(() => look().length > 0, ctx, { timeout: 3000 });
  const hits = act.find({ role: ['button', 'listitem', 'row', 'tab', 'textbox',
                                 'checkbox', 'radio', 'combobox'],
                          name: label, minScore: 0.8 })
    .filter((c) => !CONTAINER.has(c.role))
    .filter((c) => !c.region.some((r) => /option|propert|setting/i.test(r)))
    // The tile for this field NAMES this field: its accessible name is the
    // label, optionally followed by type or state text. A name that merely
    // contains the label somewhere in the middle belongs to something else.
    .filter((c) => norm(c.name).startsWith(want));
  // Fallback: identify elements by asking, not by reading.
  //
  // A canvas widget usually carries its label as its accessible name, but not
  // always -- a multi-line textbox on this platform renders under its TYPE
  // name while the store holds the right label, so the last field of two forms
  // was unfindable by name however long we waited for it. Rather than special-
  // case that widget, walk the canvas: click each element and read the label
  // out of the options panel, which is authoritative because it is what the
  // platform itself shows for the selected element.
  //
  // Bounded and only reached when the cheap path fails, so it costs a handful
  // of clicks on the few fields that carry a rule.
  if (!hits.length) {
    const found = await S.selectByInspection(label, ctx);
    if (found.ok) return found;
  }
  if (!hits.length) {
    // An escalation that says only "not found" gives a reviewer nothing to act
    // on. Showing what the agent could see turns it into a decision.
    const snap = window.__soaPerceive.snapshot();
    const visible = snap.controls
      .filter((c) => ['textbox', 'checkbox', 'radio', 'combobox', 'button'].includes(c.role))
      .filter((c) => !c.region.some((r) => /^elements$/i.test(r)) || c.role !== 'button')
      .slice(0, 40).map((c) => `${c.role}:${c.name}`);
    return { ok: false, escalate: true,
             why: `no element named "${label}" on the canvas`, sawInstead: visible };
  }

  // Among genuine matches take the SMALLEST: the tile, not whatever encloses it.
  const tile = hits.sort((a, b) => (a.box[2] * a.box[3]) - (b.box[2] * b.box[3]))[0];
  act.click(tile.id);
  await nap(ctx.settle * 3);

  // Confirm the panel is now showing this field, rather than assuming the
  // click landed. Editing the wrong element is silent and expensive.
  const shown = act.resolve({ role: 'textbox', name: ['label', 'caption', 'field label'],
                              notRegion: ['values', 'choices'] });
  if (!shown.ok) return { ok: false, why: 'clicked the element but no options panel appeared' };
  const same = String(shown.control.value || '').trim().toLowerCase() === label.trim().toLowerCase();
  if (!same) {
    return { ok: false, escalate: true,
             why: `selected an element but the panel shows "${shown.control.value}", not "${label}"` };
  }
  return { ok: true };
};

/**
 * Apply one visibility rule.
 *
 * `equals_value` is passed through exactly as the input gives it: a code for
 * coded fields, "Yes"/"No" for booleans. The platform may present the choice
 * as a picker of labels, in which case choosing by meaning is wrong -- the
 * stored value is what the rule compares. Where the control is a picker, the
 * code is tried first and the label only as a fallback, with the substitution
 * recorded.
 */
S.applyRule = async function applyRule(field, ctx) {
  const { act, log } = ctx;
  const rule = field.skip_logic;
  if (!rule) return { ok: true, skipped: 'no rule' };

  const sel = await S.selectElement(field.label, ctx);
  if (!sel.ok) return sel;

  const mode = act.resolve(Q.mode);
  if (!mode.ok) {
    return { ok: false, escalate: true,
             why: 'this platform exposes no conditional-visibility control, so the rule cannot be built here' };
  }
  // Turn conditional visibility on by meaning: the option that speaks of a
  // condition, not the one that means "always".
  // The option that speaks of a condition, whatever it is called: "Visible
  // When…", "Only when…", "Conditional".
  let chose = act.choose(mode.control.id, 'when');
  if (!chose.ok) chose = act.choose(mode.control.id, 'conditional');
  if (!chose.ok) {
    return { ok: false, escalate: true,
             why: `could not switch "${mode.control.name}" to a conditional mode`,
             available: chose.available };
  }
  await nap(ctx.settle * 3);

  const when = act.resolve(Q.whenField);
  if (!when.ok) return { ok: false, escalate: true, why: `no control to pick the controlling field: ${when.reason}` };
  const pick = act.choose(when.control.id, rule.when_field_label);
  if (!pick.ok) {
    return { ok: false, escalate: true,
             why: `the controlling field "${rule.when_field_label}" is not offered`,
             available: pick.available };
  }
  if (pick.score < 0.9) {
    return { ok: false, escalate: true,
             why: `matched controlling field "${pick.chose}" for "${rule.when_field_label}" at only ${pick.score}`,
             runnerUp: pick.runnerUp };
  }
  await nap(ctx.settle * 2);

  const val = act.resolve(Q.whenValue);
  if (!val.ok) return { ok: false, escalate: true, why: `no control for the rule's value: ${val.reason}` };
  let usedLabel = false;
  if (val.control.role === 'combobox') {
    let c = act.choose(val.control.id, rule.equals_value);
    if (!c.ok) { c = act.choose(val.control.id, String(rule.equals_value)); usedLabel = c.ok; }
    if (!c.ok) {
      return { ok: false, escalate: true,
               why: `the rule's value "${rule.equals_value}" is not offered`, available: c.available };
    }
  } else {
    act.fill(val.control.id, rule.equals_value);
  }
  await nap(ctx.settle * 2);

  // Read the rule back off the panel rather than trusting three writes.
  const back = {
    mode: act.resolve(Q.mode).control?.value,
    when: act.resolve(Q.whenField).control?.value,
    value: act.resolve(Q.whenValue).control?.value,
  };
  const whenOk = String(back.when || '').toLowerCase().includes(rule.when_field_label.toLowerCase().slice(0, 18));
  const valOk = String(back.value || '').toLowerCase().includes(String(rule.equals_value).toLowerCase());
  log?.('skip-logic', { field: field.label, ...back, usedLabel });
  if (!whenOk || !valOk) {
    return { ok: false, escalate: true,
             why: 'the visibility rule did not read back as it was set',
             wanted: { when: rule.when_field_label, value: rule.equals_value }, got: back };
  }
  return { ok: true, usedLabel };
};

S.Q = Q;
if (typeof window !== 'undefined') window.__soaSkipLogic = S;
if (typeof module !== 'undefined') module.exports = S;

})();
