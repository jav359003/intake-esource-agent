/**
 * The reviewer's side of the run.
 *
 * Two audiences use this and they want different things. Someone running it
 * for the first time needs to know what to do next; someone watching a build
 * needs to know what is happening and what will be asked of them. So the panel
 * is a three-step setup that reveals itself in order, then a live view, then a
 * queue of decisions, then a record.
 *
 * The queue is the product here, not the log. A reviewer should be able to
 * clear it without opening the platform, so every card leads with the decision
 * and carries the evidence underneath: what the agent saw, what it nearly
 * picked instead, and how many places the answer applies to.
 */
const $ = (s) => document.querySelector(s);
let ir = null, record = null, timer = null, inspected = false;

/** Say what happened, in the panel. alert() is ignored in a side panel. */
function say(text, ok = false) {
  const el = $('#status');
  el.textContent = text;
  el.className = 'status' + (ok ? ' ok' : '');
  el.hidden = false;
}
const clearSay = () => ($('#status').hidden = true);

/** Which of the three setup steps is done, and which is next. */
function steps() {
  const done1 = inspected, done2 = !!ir;
  $('#s1').className = 'step ' + (done1 ? 'complete' : 'active');
  $('#s2').className = 'step ' + (done2 ? 'complete' : done1 ? 'active' : '');
  $('#s3').className = 'step ' + (done1 && done2 ? 'active' : '');
  $('#start').disabled = !(done1 && done2);
}
steps();

const send = (msg) => new Promise((res) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) return res({ ok: false, why: 'no active tab' });
    if (!/^https?:/.test(tab.url || '')) {
      return res({ ok: false, why:
        `This panel drives a web page, but the tab is showing\n${tab.url || 'an internal page'}\n\n` +
        `Open the eSource platform in this tab and try again.` });
    }
    chrome.tabs.sendMessage(tab.id, msg, (r) => {
      const err = chrome.runtime.lastError;
      if (err || !r) return res({ ok: false, why:
        `The page did not answer.\n\n${err ? err.message : 'no reply'}\n\n` +
        `Reload the tab — the agent loads with the page — then try again.` });
      res(r);
    });
  });
});

/* ── step 1 ─────────────────────────────────────────────────────────────── */
$('#inspect').addEventListener('click', async () => {
  clearSay();
  $('#inspect').disabled = true;
  const r = await send({ type: 'discover' });
  $('#inspect').disabled = false;
  if (!r.ok) return say(r.why);
  const p = r.profile;

  if (!p.libraryEntries.length) {
    $('#platform').textContent = 'Connected — no field palette on this screen';
    $('#s1done').hidden = false;
    $('#s1done').textContent =
      'Connected. No field palette here, which is normal on a visit list — it only ' +
      'exists inside a form builder, and the agent reads it there during the run.';
    inspected = true; steps();
    return;
  }
  $('#platform').textContent =
    `${p.libraryEntries.length} field types · saves with “${p.commit.control}”`;
  $('#s1done').hidden = false;
  $('#s1done').textContent =
    `Found ${p.libraryEntries.length} field types: ${p.libraryEntries.join(', ')}.\n` +
    `Saves with “${p.commit.control}”` +
    (p.commit.decoys.length ? `, not ${p.commit.decoys.join(' or ')}.` : '.') +
    (p.reuse.canImport ? `\nForms can be reused here via “${p.reuse.importControl}”.` : '');
  inspected = true; steps();
});

/* ── step 2 ─────────────────────────────────────────────────────────────── */
$('#ir').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { ir = JSON.parse(await f.text()); }
  catch { return say(`${f.name} is not valid JSON.`); }
  const forms = ir.visits.flatMap((v) => v.forms);
  const fields = forms.flatMap((x) => x.fields);
  $('#filelabel').textContent = f.name;
  $('#s2done').hidden = false;
  $('#s2done').textContent =
    `${ir.study?.protocol_id || 'Study'} — ${ir.visits.length} visits, ${forms.length} forms, ` +
    `${fields.length} fields, ${fields.filter((x) => x.skip_logic).length} visibility rules.`;
  steps();
});

/* ── step 3 ─────────────────────────────────────────────────────────────── */
$('#savekey').addEventListener('click', async () => {
  const k = $('#key').value.trim();
  if (!k) return say('Paste a key first.');
  await chrome.storage.local.set({ openaiKey: k });
  $('#key').value = ''; $('#keybox').open = false;
  say('Key saved.', true);
});

$('#start').addEventListener('click', async () => {
  // Clicking Build twice starts a second run over the same state: forms get
  // created twice and a visit gets skipped.
  if ($('#start').disabled) return;
  $('#start').disabled = true;
  clearSay();
  $('#done').hidden = true;

  const planned = await send({ type: 'plan', ir });
  if (!planned.ok) { $('#start').disabled = false; return say(planned.why + (planned.where ? `\n\n${planned.where}` : '')); }

  $('#progress').hidden = false;
  $('#queue').hidden = false;
  send({ type: 'run' }).then((r) => {
    if (r && r.alreadyRunning) { $('#start').disabled = false; return say(r.why); }
    finish(r);
  });
  timer = setInterval(poll, 600);
});

$('#stop').addEventListener('click', async () => {
  await send({ type: 'stop' });
  clearInterval(timer);
  $('#spin').style.visibility = 'hidden';
  $('#start').disabled = false;
  say('Stopped. Building again picks up where it left off — anything already there is skipped.', true);
});

/* ── live ───────────────────────────────────────────────────────────────── */
async function poll() {
  const s = await send({ type: 'status' });
  if (!s.ok) return;
  $('#fill').style.width = (s.total ? Math.round((s.cursor / s.total) * 100) : 0) + '%';
  $('#now').textContent = s.now || (s.running ? 'Working…' : 'Finished');
  const { want, made } = s.counts || { want: {}, made: {} };
  const set = (id, k) => ($(id).textContent = `${made[k] || 0}/${want[k] || 0}`);
  set('#cVisits', 'visit'); set('#cForms', 'form');
  set('#cFields', 'field'); set('#cRules', 'skip-logic');
  renderQueue(s.gate || []);
  if (!s.running) { clearInterval(timer); $('#spin').style.visibility = 'hidden'; }
}

function renderQueue(list) {
  $('#qhead').textContent = list.length
    ? `— ${list.length} to clear` : '';
  $('#qempty').hidden = list.length > 0;
  $('#items').textContent = '';
  for (const g of list) {
    const el = document.createElement('div');
    el.className = 'item ' + (g.severity?.blocking ? 'block' : 'flag');
    el.append(node('span', 'tag', `${g.severity?.blocking ? 'blocking' : 'flagged'} · ${g.severity?.label || ''}`));
    el.append(node('div', 'q', g.question || g.why));
    if (g.severity?.cost) el.append(node('div', 'cost', g.severity.cost));
    if (g.affects > 1) {
      el.append(node('div', 'affects', `Applies to ${g.affects} places · ` +
        g.occurrences.slice(0, 3).map((o) => [o.visit, o.form, o.name].filter(Boolean).join(' › ')).join(' · ') +
        (g.affects > 3 ? ` and ${g.affects - 3} more` : '')));
    } else if (g.occurrences?.[0]?.irPath) {
      el.append(node('div', 'affects', g.occurrences[0].irPath));
    }
    for (const [k, v] of Object.entries(g.evidence || {})) {
      el.append(node('div', 'ev', `${k}:\n  ` + [].concat(v).join('\n  ')));
    }
    const opts = document.createElement('div');
    opts.className = 'opts';
    for (const label of (g.options || ['acknowledge'])) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', async () => {
        for (const id of g.ids || [g.id]) await send({ type: 'resolve', id, answer: label });
        el.classList.add('resolved'); opts.remove();
      });
      opts.append(b);
    }
    el.append(opts);
    $('#items').append(el);
  }
}

const node = (t, cls, text) => {
  const n = document.createElement(t); n.className = cls; n.textContent = text; return n;
};

/* ── finished ───────────────────────────────────────────────────────────── */
async function finish() {
  clearInterval(timer);
  $('#spin').style.visibility = 'hidden';
  $('#start').disabled = false;
  const s = await send({ type: 'status' });
  if (s.ok) renderQueue(s.gate || []);
  const rec = await send({ type: 'trace' });
  if (!rec.ok) return;
  record = rec;
  const c = rec.record.counts;
  $('#done').hidden = false;
  $('#doneline').textContent = `Built ${c.created} of ${c.created + c.failed}`;
  $('#donesub').textContent =
    [`${c.skippedAsExisting} already present`,
     c.failed ? `${c.failed} not built` : null,
     c.decisionsOutstanding ? `${c.decisionsOutstanding} decision${c.decisionsOutstanding === 1 ? '' : 's'} outstanding` : 'nothing outstanding',
    ].filter(Boolean).join(' · ');
  $('#record').textContent = rec.narrative;
}

const dl = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  if (chrome.downloads) chrome.downloads.download({ url, filename: name });
  else Object.assign(document.createElement('a'), { href: url, download: name }).click();
};
$('#dljson').addEventListener('click', () => record && dl('study-build-record.json', JSON.stringify(record.record, null, 2), 'application/json'));
$('#dltxt').addEventListener('click', () => record && dl('study-build-summary.txt', record.narrative, 'text/plain'));

// Exposed so the reviewer UI can be previewed outside Chrome (tools/preview).
window.renderQueue = renderQueue;
