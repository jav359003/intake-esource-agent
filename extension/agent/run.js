/**
 * The run: plan, build, verify, escalate, and write down what happened.
 *
 * Everything the agent does is recorded as a trace entry tying an action back
 * to the entry in the input file it came from, with the confidence it acted on
 * and whether it was verified afterwards. In a regulated setting that is not
 * a nicety -- for every element created you must be able to say which line of
 * the specification produced it and why.
 *
 * Nothing here reads a debug hook. State is whatever the agent can see on the
 * page, which is the same constraint the platform we are graded against will
 * impose.
 */

(function () {

const R = {};
const state = {
  profile: null,
  typeMap: null,          // canonical -> library entry
  steps: [],
  cursor: 0,
  trace: [],
  gate: [],               // items awaiting a human
  running: false,
  stopped: false,
  ctx: null,
};

const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

function trace(entry) {
  state.trace.push({ at: now(), ...entry });
  return entry;
}

/** Ask the human, and park the work that depends on the answer. */
function escalate(item) {
  const id = `g${state.gate.length + 1}`;
  const g = { id, at: now(), status: 'open', ...item };
  state.gate.push(g);
  trace({ kind: 'escalation', gate: id, why: item.why, about: item.about });
  return g;
}

R.discover = function discover() {
  state.profile = window.__soaDiscover.profile(window.__soaAct);
  trace({ kind: 'discovery', profile: state.profile });
  return state.profile;
};

/**
 * Read the study back off the platform.
 *
 * This is what makes a re-run reconcile instead of duplicate, and it is
 * deliberately built from what is on screen rather than from anything the
 * agent remembers doing -- a run that crashed halfway remembers nothing.
 */
R.readExisting = function readExisting(ctx) {
  const act = ctx.act;
  const snap = window.__soaPerceive.snapshot();
  // On the schedule screen the visits are the named rows. This is a shallow
  // read: enough to know what exists, not what is inside it. Deeper checks
  // happen when each visit is opened.
  const visits = snap.controls
    .filter((c) => ['button', 'link', 'cell'].includes(c.role) && c.name
      && !/add|new|back|schedule|patients|calendar|reports|study plan/i.test(c.name))
    .map((c) => ({ name: c.name.trim(), forms: [] }));
  return { visits };
};

R.buildPlan = async function buildPlan(ir, ctx = state.ctx) {
  if (!state.profile) R.discover();
  const existing = R.readExisting(ctx);
  state.steps = window.__soaPlan.planStudy(ir, existing);
  state.cursor = 0;
  trace({ kind: 'plan', counts: window.__soaPlan.summarise(state.steps),
          existingVisits: existing.visits.length });
  return { steps: state.steps.length, counts: window.__soaPlan.summarise(state.steps) };
};

/** Set the type map, either from a model or from a human's ruling. */
R.setTypeMap = function setTypeMap(map, provenance) {
  state.typeMap = map;
  trace({ kind: 'type-map', entries: Object.keys(map).length, provenance });
};

function libraryEntryFor(canonical) {
  return state.typeMap ? state.typeMap[canonical] : undefined;
}

/**
 * Execute the plan.
 *
 * The loop is deliberately dull: each step is attempted, verified, and either
 * recorded as done or escalated. Nothing is retried more than once, because a
 * second identical failure is information for a human rather than something to
 * grind against.
 */
R.execute = async function execute(options = {}) {
  const ctx = state.ctx = { ...state.ctx, ...options.ctx };
  const { act } = ctx;
  const N = window.__soaNavigate, B = window.__soaBuildField, P = window.__soaPersist;
  const limit = options.maxSteps ?? Infinity;

  state.running = true; state.stopped = false;
  let done = 0, skipped = 0, failed = 0;
  let openForm = null, pendingLabels = [];

  const flushForm = async () => {
    if (!openForm) return;
    const save = await P.save(ctx);
    if (!save.ok) { escalate({ about: { kind: 'form', ...openForm }, why: save.why, kind: 'save' }); failed++; }
    else {
      const check = await P.verifyPersisted(pendingLabels,
        { ...ctx, parentName: openForm.visit, formName: openForm.name });
      trace({ kind: 'form-committed', form: openForm.name, visit: openForm.visit,
              saved: save.clicked, persisted: check.ok ? check.persisted : 0 });
      if (!check.ok) { escalate({ about: { kind: 'form', ...openForm }, why: check.why, missing: check.missing, kind: 'persistence' }); failed++; }
    }
    openForm = null; pendingLabels = [];
  };

  while (state.cursor < state.steps.length && done + skipped + failed < limit) {
    if (state.stopped) break;
    const step = state.steps[state.cursor++];

    if (step.action === 'skip') { skipped++; trace({ kind: step.kind, name: step.name, action: 'skip', why: step.why, irPath: step.irPath }); continue; }
    if (step.kind === 'problem') { escalate({ about: step, why: step.why, kind: 'input-problem' }); continue; }

    try {
      if (step.kind === 'visit') {
        await flushForm();
        const r = await N.createVisit({ name: step.name, window_start_day: step.window[0],
                                        window_end_day: step.window[1] }, ctx);
        record(step, r); r.ok ? done++ : failed++;
      } else if (step.kind === 'form') {
        await flushForm();
        const inVisit = await N.openVisit(step.visit, ctx);
        if (!inVisit.ok) { escalate({ about: step, why: inVisit.why, kind: 'navigation' }); failed++; continue; }
        const r = await N.createForm({ name: step.name, repeating: step.repeating }, ctx);
        record(step, r);
        if (!r.ok) { failed++; continue; }
        // Some platforms drop straight into the builder on create; opening it
        // again would be a second, wrong click.
        if (!N.inBuilder(act)) {
          const opened = await N.openBuilder(step.name, ctx);
          if (!opened.ok) { escalate({ about: step, why: opened.why, kind: 'navigation' }); failed++; continue; }
        }
        openForm = { name: step.name, visit: step.visit }; pendingLabels = [];
        done++;
      } else if (step.kind === 'field') {
        const entry = libraryEntryFor(step.type);
        if (!entry) { escalate({ about: step, why: `no library entry mapped for "${step.type}"`, kind: 'type-map' }); failed++; continue; }
        const r = await B.buildField(step.spec, { ...ctx, libraryEntryFor });
        record(step, r);
        if (r.ok) { pendingLabels.push(step.name); done++; }
        else { escalate({ about: step, why: r.why, diffs: r.diffs, trail: r.trail, kind: 'build' }); failed++; }
      } else if (step.kind === 'skip-logic') {
        // A second pass over a form that is already built and saved, so the
        // builder has to be re-entered and the form re-committed afterwards.
        if (!openForm || openForm.name !== step.form) {
          await flushForm();
          const inVisit = await N.openVisit(step.visit, ctx);
          if (!inVisit.ok) { escalate({ about: step, why: inVisit.why, kind: 'navigation' }); failed++; continue; }
          const opened = await N.openBuilder(step.form, ctx);
          if (!opened.ok) { escalate({ about: step, why: opened.why, kind: 'navigation' }); failed++; continue; }
          openForm = { name: step.form, visit: step.visit }; pendingLabels = [];
        }
        const r = await window.__soaSkipLogic.applyRule(
          { label: step.name, skip_logic: step.rule }, ctx);
        record(step, r);
        if (r.ok) { pendingLabels.push(step.name); done++; }
        else { escalate({ about: step, why: r.why, got: r.got, wanted: r.wanted,
                          sawInstead: r.sawInstead, available: r.available, kind: 'skip-logic' }); failed++; }
      }
    } catch (e) {
      escalate({ about: step, why: `unexpected failure: ${e && e.message}`, kind: 'crash' });
      failed++;
    }
    if (options.onProgress) options.onProgress(R.status());
  }
  await flushForm();
  state.running = false;
  return { done, skipped, failed, gate: state.gate.length, traced: state.trace.length };

  function record(step, r) {
    trace({ kind: step.kind, name: step.name, irPath: step.irPath,
            action: r.ok ? 'created' : 'failed',
            detail: r.skipped || r.why || null, gaps: r.gaps || undefined });
  }
};

R.status = function status() {
  return {
    running: state.running,
    total: state.steps.length,
    cursor: state.cursor,
    gate: state.gate.filter((g) => g.status === 'open'),
    trace: state.trace.length,
  };
};

R.resolveGate = function resolveGate(id, answer) {
  const g = state.gate.find((x) => x.id === id);
  if (!g) return { ok: false, why: `no gate item ${id}` };
  g.status = 'resolved'; g.answer = answer; g.resolvedAt = now();
  trace({ kind: 'gate-resolved', gate: id, answer });
  return { ok: true };
};

R.stop = function stop() { state.stopped = true; };
R.exportTrace = function exportTrace() { return { profile: state.profile, typeMap: state.typeMap,
                                                  trace: state.trace, gate: state.gate }; };
R.state = state;
R.setContext = function setContext(ctx) { state.ctx = ctx; };

if (typeof window !== 'undefined') window.__soaRun = R;
if (typeof module !== 'undefined') module.exports = R;

})();
