/**
 * Deciding what to build, and in what order.
 *
 * Two problems this solves, both named in the assignment.
 *
 * ORDER. Thirteen fields are conditional on another field in the same form,
 * referenced by label. A rule cannot be set before the field it names exists,
 * so build order is not free. It is a dependency graph, and the answer is a
 * topological sort with the conditionals last. A cycle -- two fields each
 * conditional on the other -- is not resolvable and is escalated rather than
 * broken arbitrarily.
 *
 * IDEMPOTENCY. Running twice must not produce two Demographics under
 * Screening. Every create is preceded by a look: does something with this name
 * already exist in this parent? A re-run therefore reconciles rather than
 * duplicates, and a run interrupted halfway can be resumed by running it
 * again.
 */

(function () {

const PL = {};

/**
 * Order one form's fields so every conditional comes after the field it
 * depends on.
 *
 * Returns the order plus anything unresolvable, because a rule whose
 * controlling field does not exist in this form is a defect in the input or a
 * misread label, and either way a human should see it rather than have the
 * rule silently dropped.
 */
PL.orderFields = function orderFields(fields) {
  const byLabel = new Map(fields.map((f) => [f.label.trim().toLowerCase(), f]));
  const problems = [];

  const deps = new Map();
  for (const f of fields) {
    const dep = f.skip_logic?.when_field_label;
    if (!dep) { deps.set(f, null); continue; }
    const target = byLabel.get(dep.trim().toLowerCase());
    if (!target) {
      problems.push({
        field: f.label,
        why: `its visibility rule names "${dep}", which is not a field in this form`,
      });
      deps.set(f, null);          // build it anyway; the rule is what is at risk
    } else if (target === f) {
      problems.push({ field: f.label, why: 'its visibility rule refers to itself' });
      deps.set(f, null);
    } else {
      deps.set(f, target);
    }
  }

  const order = [];
  const state = new Map();        // undefined | 'visiting' | 'done'
  const visit = (f, trail) => {
    if (state.get(f) === 'done') return;
    if (state.get(f) === 'visiting') {
      problems.push({
        field: f.label,
        why: `circular visibility rules: ${[...trail, f].map((x) => x.label).join(' -> ')}`,
      });
      return;
    }
    state.set(f, 'visiting');
    const dep = deps.get(f);
    if (dep) visit(dep, [...trail, f]);
    state.set(f, 'done');
    order.push(f);
  };
  // Source order is preserved among independent fields: the input says the
  // field order is meaningful and should be kept where the platform allows.
  for (const f of fields) visit(f, []);

  return {
    order,
    conditional: order.filter((f) => f.skip_logic),
    problems,
  };
};

/**
 * A plan for the whole study: what exists, what must be made, in what order.
 *
 * `existing` is what the agent read off the platform, not what it remembers
 * doing. That is what makes a re-run safe after a crash: the plan is recomputed
 * from the platform's current state every time.
 */
PL.planStudy = function planStudy(ir, existing) {
  const steps = [];
  const seenForms = new Map();          // definition name -> where it was first built

  for (const visit of ir.visits) {
    const haveVisit = existing.visits.find((v) => sameName(v.name, visit.name));
    steps.push({
      kind: 'visit',
      name: visit.name,
      action: haveVisit ? 'skip' : 'create',
      why: haveVisit ? 'a visit with this name already exists' : null,
      window: [visit.window_start_day, visit.window_end_day],
      irPath: `visits[${visit.name}]`,
    });

    for (const form of visit.forms) {
      const haveForm = haveVisit?.forms?.find((f) => sameName(f.name, form.name));
      const builtBefore = seenForms.get(form.name.trim().toLowerCase());

      steps.push({
        kind: 'form',
        visit: visit.name,
        name: form.name,
        repeating: Boolean(form.repeating),
        action: haveForm ? 'skip' : 'create',
        why: haveForm ? 'a form with this name already exists under this visit' : null,
        // Reuse is a platform question answered by discovery and ruled on once
        // by a human, so the plan records the opportunity without taking it.
        reuseCandidate: builtBefore ? { firstBuiltAt: builtBefore } : null,
        irPath: `visits[${visit.name}].forms[${form.name}]`,
      });
      seenForms.set(form.name.trim().toLowerCase(), visit.name);

      const { order, conditional, problems } = PL.orderFields(form.fields);
      for (const p of problems) {
        steps.push({ kind: 'problem', visit: visit.name, form: form.name, ...p });
      }
      for (const field of order) {
        const haveField = haveForm?.fields?.find((x) => sameName(x.label, field.label));
        steps.push({
          kind: 'field',
          visit: visit.name,
          form: form.name,
          name: field.label,
          type: field.type,
          action: haveField ? 'skip' : 'create',
          why: haveField ? 'a field with this label already exists in this form' : null,
          irPath: `visits[${visit.name}].forms[${form.name}].fields[${field.label}]`,
          spec: field,
        });
      }
      // Visibility rules are a second pass over the form, once every field it
      // could reference exists.
      for (const field of conditional) {
        steps.push({
          kind: 'skip-logic',
          visit: visit.name,
          form: form.name,
          name: field.label,
          rule: field.skip_logic,
          action: 'create',
          irPath: `visits[${visit.name}].forms[${form.name}].fields[${field.label}].skip_logic`,
        });
      }
    }
  }
  return steps;
};

function sameName(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

PL.sameName = sameName;
PL.summarise = function summarise(steps) {
  const c = {};
  for (const s of steps) {
    const k = `${s.kind}:${s.action ?? 'note'}`;
    c[k] = (c[k] || 0) + 1;
  }
  return c;
};

if (typeof window !== 'undefined') window.__soaPlan = PL;
if (typeof module !== 'undefined') module.exports = PL;

})();
