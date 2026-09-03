/**
 * Getting to the screen where a thing can be done.
 *
 * Screen order is one of the things the assignment forbids hardcoding, so
 * navigation is written as goals rather than as a route: "be on a screen where
 * visits can be added", "be inside this visit", "be in this form's builder".
 * Each goal checks whether it is already satisfied before doing anything, which
 * is what makes the whole run resumable and safe to re-enter.
 */

(function () {

const N = {};
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

const Q = {
  // "+ New Source Document" scores 0.5 against "new visit" -- they share the
  // word "new" -- which was enough for the climb to stop one screen too early
  // and then fail. Adding a visit is not adding anything else.
  // Action and object given separately, so any combination the platform uses
  // reads the same: "+ Add Visit", "Create Timepoint", "New Event".
  addVisit:   { role: 'button', verb: ['add', 'new', 'create', 'define'],
                noun: ['visit', 'timepoint', 'event', 'occasion', 'encounter'],
                name: ['add visit', 'new visit', 'create visit', 'add timepoint'],
                notName: ['document', 'form', 'page', 'field', 'element', 'value', 'patient'] },
  visitName:  { role: 'textbox', name: ['visit name', 'timepoint name', 'name', 'title', 'label'] },
  winStart:   { role: 'textbox', name: ['window start', 'window opens', 'start day', 'from day', 'earliest', 'opens'] },
  winEnd:     { role: 'textbox', name: ['window end', 'window closes', 'end day', 'to day', 'latest', 'closes'] },
  addForm:    { role: 'button', verb: ['add', 'new', 'create', 'define'],
                noun: ['document', 'form', 'page', 'crf', 'casebook', 'instrument'],
                name: ['new source document', 'new form', 'add form', 'new document', 'new crf'],
                notName: ['visit', 'timepoint', 'patient', 'value', 'element', 'library'] },
  formName:   { role: 'textbox', name: ['document name', 'form name', 'page title', 'name', 'title'] },
  // Repeating is a checkbox on one platform and a picklist on another
  // ("Record Style": Single record / Repeating log), so both roles are allowed.
  repeating:  { role: ['checkbox', 'switch', 'combobox'],
                name: ['repeating', 'log', 'record style', 'multiple records', 'many records'] },
  openBuilder:{ role: ['button', 'link'], name: ['edit', 'open', 'design', 'build', 'configure', 'layout'],
                notNav: true, notName: ['delete', 'remove', 'retire', 'preview'] },
};

/**
 * A control that commits the dialog these fields belong to.
 *
 * "Add" is deliberately NOT a synonym for committing. The control that OPENS
 * a dialog is very often called "+ Add Visit" while the one that commits it is
 * "Save Visit", and treating both as the same intent makes them score within
 * 0.05 of each other -- the agent then either refuses (correct, but stuck) or
 * reopens the dialog it is trying to close. Opening and committing are
 * different goals and get different vocabularies.
 */
function commitNear(anchor) {
  return { role: 'button',
           name: ['save', 'create', 'submit', 'confirm', 'done', 'ok', 'apply', 'store', 'add'],
           // Only distinctive single words belong here. Phrases like "add
           // visit" share "visit" with "Save Visit" and demote the very
           // control they were meant to protect. What actually separates the
           // opener from the committer is position: the opener sits outside
           // the dialog, so the `near` anchor does that job properly.
           notName: ['template', 'cancel', 'close', 'delete', 'discard', 'abandon'],
           // Must be inside the dialog it commits. The control that OPENED the
           // dialog sits outside it, which is what separates them on every
           // platform regardless of wording.
           near: anchor, nearOnly: true };
}

async function press(act, query, ctx, label) {
  const r = act.resolve(query);
  if (!r.ok) return { ok: false, why: `${label}: ${r.reason}` };
  if (!r.confident) {
    return { ok: false, escalate: true, why: `${label}: ambiguous (margin ${r.margin})`,
             candidates: r.candidates.map((c) => `${c.name} (${c.score})`) };
  }
  act.click(r.control.id);
  await nap(ctx.settle * 3);
  return { ok: true, clicked: r.control.name };
}

async function type(act, query, value, ctx, label) {
  const r = act.resolve(query);
  if (!r.ok) return { ok: false, why: `${label}: ${r.reason}` };
  act.fill(r.control.id, value);
  await nap(ctx.settle);
  return { ok: true, filled: r.control.name };
}

/** Is a control named exactly this on the page right now? */
/**
 * Wait until the page satisfies a condition, rather than sleeping a guess.
 *
 * Every navigation here was a click followed by a fixed pause. That works
 * until it does not: the skip-logic pass re-opened a form and checked its
 * canvas before the builder had rendered, reported the field missing, and then
 * navigated on -- leaving a page that, inspected afterwards, plainly contained
 * the field it had just failed to find. A fixed sleep encodes a machine's
 * speed as if it were part of the platform.
 */
N.waitFor = async function waitFor(test, ctx, { timeout = 3000, every = 60 } = {}) {
  const started = Date.now();
  for (;;) {
    try { if (test()) return { ok: true, waited: Date.now() - started }; } catch { /* mid-render */ }
    if (Date.now() - started > timeout) return { ok: false, waited: Date.now() - started };
    await nap(every);
  }
};

/**
 * Is something with this name on screen?
 *
 * Headings count, not just rows. Platforms differ in what happens after you
 * create a thing: Mock A returns you to a list where the new row appears, Mock
 * B drops you straight into its editor where the name is the page heading.
 * Checking only for a row made a successful creation look like a failure --
 * the fields were then built into an editor the run did not know it was in,
 * and never committed.
 */
N.seesName = function seesName(act, name) {
  if (act.find({ role: ['button', 'link', 'row', 'cell', 'gridcell', 'listitem', 'tab', 'heading'],
                 name, minScore: 0.95 }).some((c) => c.score >= 0.95)) return true;
  const snap = window.__soaPerceive.snapshot();
  return (snap.heading || '').trim().toLowerCase() === String(name).trim().toLowerCase();
};

/** Are we already inside a form builder, rather than a list? */
N.inBuilder = function inBuilder(act) {
  return act.find({ role: 'button',
                    name: ['text', 'date', 'number', 'dropdown', 'picklist', 'checkbox',
                           'radio', 'calculated', 'time'] }).length >= 4;
};

/**
 * Walk back until the screen offers the control this goal needs.
 *
 * After finishing a form the agent is three screens deep, and the control that
 * adds a visit does not exist down there. The first full run built Screening
 * perfectly and then failed every remaining visit for exactly this reason --
 * it never went back up. Rather than encode a route (which is screen order,
 * and forbidden), this climbs by pressing whatever leads outward and stops as
 * soon as the wanted control appears.
 */
/**
 * The control that leads outward from this screen.
 *
 * Word matching alone is not enough: breadcrumbs are routinely named after
 * their DESTINATION rather than the act of leaving, so the way out of this
 * platform's form builder is "← Screening" and shares no word with "back" or
 * "schedule". What it does carry is a leading back-arrow, which is a
 * convention rather than a platform detail -- and position, since a breadcrumb
 * sits at the top left of the content.
 *
 * Arrow first, then wording, then the top-left-most non-chrome control.
 */
N.wayOut = function wayOut(act) {
  const snap = window.__soaPerceive.snapshot();
  const clickable = snap.controls.filter((c) => ['button', 'link'].includes(c.role) && c.name
    && !c.inNav
    && !/delete|remove|cancel|discard|save|activate|preview|template/i.test(c.name));

  const arrowed = clickable.filter((c) => /^\s*[←‹⟵«<⇦]/.test(c.name));
  if (arrowed.length) return arrowed.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])[0];

  const worded = act.resolve({ role: ['button', 'link'],
                               name: ['back', 'schedule', 'return', 'close', 'up', 'plan', 'overview'],
                               notName: ['delete', 'remove', 'cancel'] });
  if (worded.ok) return worded.control;
  return null;
};

N.ensureCan = async function ensureCan(query, ctx, { hops = 4 } = {}) {
  const { act } = ctx;
  for (let i = 0; i <= hops; i++) {
    // Confident, not merely present. A loose match on the wrong screen stops
    // the climb one level short and the goal then fails where it stood.
    const here = act.resolve(query);
    if (here.ok && here.confident) return { ok: true, hops: i };
    const out = N.wayOut(act);
    if (!out) break;
    act.click(out.id);
    await nap(ctx.settle * 4);
  }
  const last = act.resolve(query);
  return last.ok && last.confident
    ? { ok: true, hops }
    : { ok: false, why: `could not reach a screen offering ${JSON.stringify(query.name)}` +
                        (last.ok ? ` (best here: "${last.control.name}", margin ${last.margin})` : '') };
};

N.createVisit = async function createVisit(visit, ctx) {
  const { act } = ctx;
  const reach = await N.ensureCan(Q.addVisit, ctx);
  if (!reach.ok) return reach;
  if (N.seesName(act, visit.name)) return { ok: true, skipped: 'already present' };

  let r = await press(act, Q.addVisit, ctx, 'open the add-visit form');
  if (!r.ok) return r;
  r = await type(act, Q.visitName, visit.name, ctx, 'visit name');
  if (!r.ok) return r;
  // Windows are optional on some platforms; a missing field is not a failure,
  // it is a capability gap worth noting.
  const gaps = [];
  if (visit.window_start_day !== undefined) {
    const s = await type(act, Q.winStart, visit.window_start_day, ctx, 'window start');
    if (!s.ok) gaps.push('window start not settable');
  }
  if (visit.window_end_day !== undefined) {
    const e = await type(act, Q.winEnd, visit.window_end_day, ctx, 'window end');
    if (!e.ok) gaps.push('window end not settable');
  }
  r = await press(act, commitNear(Q.visitName), ctx, 'commit the visit');
  if (!r.ok) return r;

  await nap(ctx.settle * 3);
  if (!N.seesName(act, visit.name)) {
    return { ok: false, escalate: true,
             why: `clicked "${r.clicked}" but no visit named "${visit.name}" appeared` };
  }
  return { ok: true, gaps };
};

N.openVisit = async function openVisit(visitName, ctx) {
  const { act } = ctx;
  // Same climb: opening a visit is only possible from the schedule.
  await N.ensureCan({ role: ['button', 'link', 'cell', 'gridcell'], name: visitName,
                      notName: ['schedule', 'back'], minScore: 0.9 }, ctx);
  const r = act.resolve({ role: ['button', 'link', 'cell', 'gridcell'], name: visitName,
                          notName: ['schedule', 'back', 'delete', 'remove'], minScore: 0.9 });
  if (!r.ok) return { ok: false, why: `cannot open visit "${visitName}": ${r.reason}` };
  act.click(r.control.id);
  await N.waitFor(() => act.resolve(Q.addForm).ok, ctx, { timeout: 3000 });
  return { ok: true };
};

N.createForm = async function createForm(form, ctx) {
  const { act } = ctx;
  if (N.seesName(act, form.name)) return { ok: true, skipped: 'already present' };

  let r = await press(act, Q.addForm, ctx, 'open the new-document form');
  if (!r.ok) return r;
  r = await type(act, Q.formName, form.name, ctx, 'document name');
  if (!r.ok) return r;

  const gaps = [];
  if (form.repeating) {
    const rep = act.resolve(Q.repeating);
    if (!rep.ok) gaps.push('this platform offers no way to mark a form repeating here');
    else if (rep.control.role === 'combobox' || rep.control.role === 'listbox') {
      // Mock A ticks a box; Mock B picks "Repeating log" from a "Record Style"
      // list. Same concept, different control, so choose by meaning rather
      // than assuming a toggle.
      const c = act.choose(rep.control.id, 'repeating');
      if (!c.ok) {
        const alt = act.choose(rep.control.id, 'log');
        if (!alt.ok) gaps.push(`could not select a repeating option in "${rep.control.name}"`);
      }
    } else {
      act.setChecked(rep.control.id, true);
    }
    await nap(ctx.settle);
  }
  r = await press(act, commitNear(Q.formName), ctx, 'commit the document');
  if (!r.ok) return r;

  await nap(ctx.settle * 3);
  // Created if the platform now shows it, or if it has taken us straight into
  // the editor for it. Both are success; only neither is a failure.
  const landed = N.seesName(act, form.name) || N.inBuilder(act);
  if (!landed) {
    return { ok: false, escalate: true,
             why: `clicked "${r.clicked}" but no document named "${form.name}" appeared` };
  }
  return { ok: true, gaps, openedBuilder: !N.seesName(act, form.name) || N.inBuilder(act) };
};

/**
 * Open the builder for a named form.
 *
 * The edit control is anchored to the row carrying the form's name, because a
 * visit with seven documents has seven identical "Edit" buttons and the only
 * thing distinguishing them is which row they sit in.
 */
N.openBuilder = async function openBuilder(formName, ctx) {
  const { act } = ctx;
  const r = act.resolve({ ...Q.openBuilder,
                          near: { role: ['button', 'link', 'cell', 'gridcell', 'columnheader', 'row', 'listitem'], name: formName } });
  if (!r.ok) return { ok: false, why: `cannot open the builder for "${formName}": ${r.reason}` };
  act.click(r.control.id);
  // The builder is ready when its element library is on screen, which is a
  // property of the platform rather than of how fast this machine is.
  const ready = await N.waitFor(
    () => act.find({ role: 'button', name: ['single line', 'text', 'date', 'number', 'dropdown',
                                            'checkbox', 'radio', 'calculated'] }).length >= 3,
    ctx, { timeout: 4000 });
  if (!ready.ok) return { ok: false, why: `opened "${formName}" but no element library appeared within 4s` };
  return { ok: true, waited: ready.waited };
};

N.Q = Q;
N.nap = nap;
if (typeof window !== 'undefined') window.__soaNavigate = N;
if (typeof module !== 'undefined') module.exports = N;

})();
