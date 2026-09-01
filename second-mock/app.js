/**
 * Veridian EDC — a second eSource, written to be as unlike Mock A as possible
 * while modelling the same clinical concepts.
 *
 * The point of this file is to be a fair test, not an easy one. Everything the
 * agent could have accidentally learned about Mock A is different here:
 *
 *   vocabulary   Visit -> Timepoint, Source Document -> Casebook Page,
 *                Elements -> Field Palette, Save -> Commit Draft
 *   type names   Dropdown -> Picklist, Check List -> Multi-Pick,
 *                Checkbox -> Tick Box, Radio Buttons -> Option Group,
 *                Number (Whole) -> Whole Number, Yes/No Toggle -> Yes / No
 *   layout       palette on the RIGHT, properties on the LEFT (mirrored)
 *   screens      the schedule is reached through a "Design" module, and a
 *                casebook page opens straight into the builder -- one screen
 *                fewer than Mock A
 *   DOM          no tables, no <button> for rows; div[role=grid] and
 *                div[role=button], different class names, different ids
 *   repeating    a select ("Record Style") rather than a checkbox
 *   decoys       "Commit to Library" sits next to "Commit Draft", and
 *                "Publish" next to both
 *
 * What is deliberately NOT different: it exposes correct ARIA roles and
 * accessible names, because that is what every usable web application does and
 * it is the contract the agent is built against. A mock that hid its semantics
 * would be testing whether the agent can read minds, not whether it generalises.
 */

const TYPES = [
  ['Derived Value', 'calculated'], ['Multi-Pick', 'multi_select'], ['Tick Box', 'checkbox'],
  ['Calendar Date', 'date'], ['Date & Clock', 'datetime'], ['Picklist', 'single_select'],
  ['Long Text', 'textarea'], ['Decimal Number', 'decimal'], ['Whole Number', 'integer'],
  ['Option Group', 'radio'], ['Short Text', 'text'], ['Clock Time', 'time'], ['Yes / No', 'boolean'],
];
const CANON = Object.fromEntries(TYPES.map(([label, c]) => [label, c]));

const store = { timepoints: [], selected: null, openPage: null, draft: null, module: 'design' };
let uid = 0;
const nid = (p) => `${p}${++uid}`;

const h = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'onclick') n.addEventListener('click', v);
    else if (k === 'oninput') n.addEventListener('input', v);
    else if (k === 'onchange') n.addEventListener('change', v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of [].concat(kids)) n.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return n;
};
/** Clickable divs, not buttons: the DOM shape differs, the semantics do not. */
const tap = (label, onclick, cls = 'vx-tap') =>
  h('div', { role: 'button', tabindex: '0', class: cls, 'aria-label': label, onclick }, [label]);

const field = (labelText, inputEl) => {
  const id = nid('vf');
  inputEl.setAttribute('id', id);
  return h('div', { class: 'vx-field' }, [h('label', { for: id }, [labelText]), inputEl]);
};

function render() {
  const root = document.getElementById('root');
  root.textContent = '';
  root.append(
    h('div', { class: 'vx-top' }, [
      h('span', { class: 'vx-mark' }, ['Veridian EDC']),
      h('nav', { role: 'navigation', 'aria-label': 'Workspaces' }, [
        tap('Subjects', () => {}, 'vx-mod'),
        tap('Monitoring', () => {}, 'vx-mod'),
        tap('Design', () => { store.module = 'design'; store.openPage = null; store.selected = null; render(); }, 'vx-mod vx-on'),
        tap('Exports', () => {}, 'vx-mod'),
      ]),
      h('span', { class: 'vx-study' }, ['ABC-101']),
    ]),
  );
  root.append(store.openPage ? builder() : store.selected ? timepoint() : schedule());
}

/* ── screen 1: the schedule ─────────────────────────────────────────────── */
function schedule() {
  const wrap = h('section', { class: 'vx-pane' }, [h('h2', {}, ['Timepoint Plan'])]);
  const grid = h('div', { role: 'grid', 'aria-label': 'Timepoints' });
  if (!store.timepoints.length) grid.append(h('div', { class: 'vx-empty' }, ['No timepoints yet.']));
  for (const t of store.timepoints) {
    grid.append(h('div', { role: 'row', class: 'vx-row' }, [
      tap(t.name, () => { store.selected = t; render(); }, 'vx-link'),
      h('span', { role: 'gridcell' }, [`${t.from} to ${t.to}`]),
      h('span', { role: 'gridcell' }, [`${t.pages.length} pages`]),
    ]));
  }
  wrap.append(grid);

  if (store.draft?.kind === 'timepoint') {
    const d = store.draft;
    wrap.append(h('div', { role: 'group', 'aria-label': 'New Timepoint', class: 'vx-card' }, [
      field('Timepoint Name', h('input', { type: 'text', value: d.name, oninput: (e) => (d.name = e.target.value) })),
      field('Window Opens (day)', h('input', { type: 'text', value: d.from, oninput: (e) => (d.from = e.target.value) })),
      field('Window Closes (day)', h('input', { type: 'text', value: d.to, oninput: (e) => (d.to = e.target.value) })),
      h('div', { class: 'vx-actions' }, [
        tap('Store Timepoint', () => {
          if (!d.name.trim()) return;
          store.timepoints.push({ name: d.name.trim(), from: d.from, to: d.to, pages: [] });
          store.draft = null; render();
        }, 'vx-tap vx-primary'),
        tap('Abandon', () => { store.draft = null; render(); }),
      ]),
    ]));
  } else {
    wrap.append(tap('Create Timepoint', () => { store.draft = { kind: 'timepoint', name: '', from: '', to: '' }; render(); }, 'vx-tap vx-primary'));
  }
  return wrap;
}

/* ── screen 2: one timepoint's casebook pages ───────────────────────────── */
function timepoint() {
  const t = store.selected;
  const wrap = h('section', { class: 'vx-pane' }, [
    h('div', { class: 'vx-crumb' }, [
      tap('‹ Timepoint Plan', () => { store.selected = null; render(); }, 'vx-link'),
      h('h2', {}, [t.name]),
    ]),
  ]);
  const grid = h('div', { role: 'grid', 'aria-label': 'Casebook Pages' });
  for (const p of t.pages) {
    grid.append(h('div', { role: 'row', class: 'vx-row' }, [
      h('span', { role: 'gridcell' }, [p.name]),
      h('span', { role: 'gridcell' }, [p.style]),
      h('span', { role: 'gridcell' }, [p.state]),
      tap('Layout', () => { store.openPage = p; render(); }, 'vx-link'),
      tap('Retire', () => { t.pages = t.pages.filter((x) => x !== p); render(); }, 'vx-link'),
    ]));
  }
  if (!t.pages.length) grid.append(h('div', { class: 'vx-empty' }, ['No casebook pages yet.']));
  wrap.append(grid);

  if (store.draft?.kind === 'page') {
    const d = store.draft;
    wrap.append(h('div', { role: 'group', 'aria-label': 'New Casebook Page', class: 'vx-card' }, [
      field('Page Title', h('input', { type: 'text', value: d.name, oninput: (e) => (d.name = e.target.value) })),
      field('Record Style', h('select', { onchange: (e) => (d.style = e.target.value) }, [
        h('option', { value: 'Single record' }, ['Single record']),
        h('option', { value: 'Repeating log' }, ['Repeating log']),
      ])),
      h('div', { class: 'vx-actions' }, [
        tap('Add Page', () => {
          if (!d.name.trim()) return;
          const p = { name: d.name.trim(), style: d.style || 'Single record', state: 'Draft', els: [], saved: null };
          t.pages.push(p); store.draft = null; store.openPage = p; render();
        }, 'vx-tap vx-primary'),
        tap('Abandon', () => { store.draft = null; render(); }),
      ]),
    ]));
  } else {
    wrap.append(tap('Add Casebook Page', () => { store.draft = { kind: 'page', name: '', style: 'Single record' }; render(); }, 'vx-tap vx-primary'));
  }
  return wrap;
}

/* ── screen 3: the builder. Properties LEFT, palette RIGHT. ─────────────── */
function builder() {
  const p = store.openPage;
  const sel = p.els.find((e) => e.id === p.selId) || null;

  const head = h('div', { class: 'vx-crumb' }, [
    tap(`‹ ${store.selected.name}`, () => { store.openPage = null; p.selId = null; render(); }, 'vx-link'),
    h('h2', {}, [p.name]),
    h('span', { class: 'vx-state' }, [p.state]),
    h('div', { class: 'vx-actions' }, [
      tap('Commit to Library', () => {}, 'vx-tap'),
      tap('Commit Draft', () => { p.saved = JSON.parse(JSON.stringify(p.els)); render(); }, 'vx-tap vx-primary'),
      tap('Publish', () => { if (p.saved) p.state = 'Published'; render(); }, 'vx-tap'),
    ]),
  ]);

  /* properties, on the LEFT */
  const props = h('aside', { role: 'complementary', 'aria-label': 'Field Properties', class: 'vx-props' },
    [h('h3', {}, ['Field Properties'])]);
  if (!sel) props.append(h('p', { class: 'vx-muted' }, ['Nothing selected.']));
  else {
    props.append(field('Field Label', h('input', { type: 'text', value: sel.label, oninput: (e) => { sel.label = e.target.value; renderSoon(); } })));
    props.append(field('Field Kind', h('select', { onchange: (e) => { sel.kind = e.target.value; renderSoon(); } },
      TYPES.map(([l]) => h('option', { value: l, selected: l === sel.kind }, [l])))));
    props.append(h('div', { class: 'vx-field' }, [
      h('label', {}, [h('input', { type: 'checkbox', checked: sel.required, onchange: (e) => { sel.required = e.target.checked; } }), ' Answer Required']),
    ]));
    if (['decimal', 'integer'].includes(CANON[sel.kind])) {
      props.append(field('Lowest Allowed', h('input', { type: 'text', value: sel.min ?? '', oninput: (e) => (sel.min = e.target.value) })));
      props.append(field('Highest Allowed', h('input', { type: 'text', value: sel.max ?? '', oninput: (e) => (sel.max = e.target.value) })));
      props.append(field('Measure', h('input', { type: 'text', value: sel.units ?? '', oninput: (e) => (sel.units = e.target.value) })));
    }
    if (CANON[sel.kind] === 'calculated') {
      props.append(field('Expression', h('input', { type: 'text', value: sel.formula ?? '', oninput: (e) => (sel.formula = e.target.value) })));
    }
    if (['single_select', 'multi_select', 'radio'].includes(CANON[sel.kind])) {
      const box = h('div', { role: 'group', 'aria-label': 'Coded Choices', class: 'vx-choices' });
      sel.choices = sel.choices || [];
      sel.choices.forEach((c, i) => {
        box.append(h('div', { class: 'vx-choice' }, [
          field('Stored Code', h('input', { type: 'text', value: c.code, oninput: (e) => (c.code = e.target.value) })),
          field('Shown Text', h('input', { type: 'text', value: c.label, oninput: (e) => (c.label = e.target.value) })),
          tap('Drop', () => { sel.choices.splice(i, 1); render(); }, 'vx-link'),
        ]));
      });
      box.append(tap('Append Choice', () => { sel.choices.push({ code: '', label: '' }); render(); }, 'vx-tap'));
      props.append(box);
    }
    const rule = h('div', { role: 'group', 'aria-label': 'Display Rule', class: 'vx-rule' }, [
      field('Display Rule', h('select', { onchange: (e) => { sel.rule = e.target.value === 'Only when…' ? { when: '', eq: '' } : null; render(); } }, [
        h('option', { value: 'Always shown', selected: !sel.rule }, ['Always shown']),
        h('option', { value: 'Only when…', selected: !!sel.rule }, ['Only when…']),
      ])),
    ]);
    if (sel.rule) {
      rule.append(field('Governing Field', h('select', { onchange: (e) => (sel.rule.when = e.target.value) },
        [h('option', { value: '' }, ['— pick —'])].concat(
          p.els.filter((e) => e.id !== sel.id).map((e) => h('option', { value: e.label, selected: sel.rule.when === e.label }, [e.label]))))));
      rule.append(field('Required Answer', h('input', { type: 'text', value: sel.rule.eq, oninput: (e) => (sel.rule.eq = e.target.value) })));
    }
    props.append(rule);
    props.append(tap('Remove Field', () => { p.els = p.els.filter((e) => e !== sel); p.selId = null; render(); }, 'vx-tap'));
  }

  /* canvas, middle */
  const canvas = h('div', { role: 'region', 'aria-label': 'Page Layout', class: 'vx-canvas' });
  if (!p.els.length) canvas.append(h('p', { class: 'vx-muted' }, ['Pick a field kind from the palette.']));
  for (const e of p.els) {
    const canon = CANON[e.kind];
    const inner = [];
    if (['single_select'].includes(canon)) {
      inner.push(h('select', { 'aria-label': e.label }, [h('option', {}, ['— choose —'])].concat((e.choices || []).map((c) => h('option', {}, [c.label])))));
    } else if (['radio', 'multi_select'].includes(canon)) {
      for (const c of (e.choices || [])) {
        inner.push(h('label', {}, [h('input', { type: canon === 'radio' ? 'radio' : 'checkbox', 'aria-label': `${e.label} — ${c.label}` }), c.label]));
      }
    } else if (canon === 'checkbox' || canon === 'boolean') {
      inner.push(h('label', {}, [h('input', { type: 'checkbox', 'aria-label': e.label }), e.label]));
    } else if (canon === 'textarea') {
      inner.push(h('textarea', { rows: '2', 'aria-label': e.label }));
    } else {
      inner.push(h('input', { type: 'text', 'aria-label': e.label }));
    }
    canvas.append(h('div', {
      role: 'group', 'aria-label': `${e.label} (${e.kind})`,
      class: 'vx-el' + (e.id === p.selId ? ' vx-sel' : ''),
      onclick: () => { p.selId = e.id; render(); },
    }, [h('span', { class: 'vx-el-name' }, [e.label]), ...inner]));
  }

  /* palette, on the RIGHT */
  const palette = h('aside', { role: 'complementary', 'aria-label': 'Field Palette', class: 'vx-palette' },
    [h('h3', {}, ['Field Palette'])]);
  palette.append(field('Filter', h('input', { type: 'text', placeholder: 'Filter kinds…' })));
  for (const [label] of TYPES) {
    palette.append(tap(label, () => {
      const e = { id: nid('e'), kind: label, label, required: false, choices: [] };
      p.els.push(e); p.selId = e.id; render();
    }, 'vx-kind'));
  }
  palette.append(tap('Copy From Another Page…', () => {}, 'vx-tap'));

  return h('section', { class: 'vx-pane' }, [head, h('div', { class: 'vx-three' }, [props, canvas, palette])]);
}

let pending = null;
function renderSoon() { clearTimeout(pending); pending = setTimeout(render, 120); }

/* A verification hook for a human, exactly as Mock A has one. The agent must
   never use it; it exists so a person can diff a run against the spec. */
window.__dump = () => ({
  platform: 'veridian-edc',
  timepoints: store.timepoints.map((t) => ({
    name: t.name, from: t.from, to: t.to,
    pages: t.pages.map((p) => ({
      name: p.name, style: p.style, state: p.state,
      fields: (p.saved || []).map((e) => ({
        label: e.label, canonical: CANON[e.kind], kind: e.kind, required: !!e.required,
        min: e.min, max: e.max, units: e.units, formula: e.formula,
        choices: (e.choices || []).map((c) => ({ code: c.code, label: c.label })),
        rule: e.rule && e.rule.when ? { when: e.rule.when, equals: e.rule.eq } : null,
      })),
    })),
  })),
});
window.__reset = () => { store.timepoints = []; store.selected = null; store.openPage = null; store.draft = null; render(); };

render();
