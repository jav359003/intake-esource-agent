/**
 * The reviewer's side of the run.
 *
 * The queue is the product here, not the log. A reviewer should be able to
 * clear it without opening the platform, so every item leads with the decision
 * and carries the evidence underneath: what the agent saw, what it nearly
 * picked instead, and how many places the answer applies to.
 */
const $ = (s) => document.querySelector(s);
let ir = null, record = null, timer = null;

/**
 * Say what happened, in the panel.
 *
 * alert() is ignored in a Chrome side panel, so the first version of this
 * reported every failure into the void -- clicking Inspect platform on a tab
 * whose content scripts had not injected did nothing at all, with no way to
 * tell a broken extension from a broken click.
 */
function say(text, ok = false) {
  const el = $('#status');
  el.textContent = text;
  el.className = 'status' + (ok ? ' ok' : '');
  el.hidden = false;
}
function clearSay() { $('#status').hidden = true; }

const send = (msg) => new Promise((res) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) return res({ ok: false, why: 'no active tab' });
    // A content script cannot run on chrome:// pages or the extensions page,
    // and it only injects on page load -- so a tab opened before the extension
    // was loaded has none. Both are ordinary situations that need saying, not
    // failing silently.
    if (!/^https?:/.test(tab.url || '')) {
      return res({ ok: false, why: `This panel drives a web page, but the tab is showing\n${tab.url || 'an internal page'}\n\nOpen the eSource platform in this tab and try again.` });
    }
    chrome.tabs.sendMessage(tab.id, msg, (r) => {
      const err = chrome.runtime.lastError;
      if (err || !r) {
        return res({ ok: false, why: `The page did not answer.\n\n${err ? err.message : 'no reply'}\n\nReload the tab (the agent only loads with the page) and try again.` });
      }
      res(r);
    });
  });
});

$('#ir').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  ir = JSON.parse(await f.text());
  const forms = ir.visits.flatMap((v) => v.forms);
  const fields = forms.flatMap((f) => f.fields);
  $('#irsummary').textContent =
    `${ir.study?.protocol_id || 'study'} — ${ir.visits.length} visits, ${forms.length} forms, ` +
    `${fields.length} fields, ${fields.filter((x) => x.skip_logic).length} visibility rules`;
  $('#start').disabled = false;
});

$('#savekey').addEventListener('click', async () => {
  const k = $('#key').value.trim();
  if (!k) return say('Paste a key first.');
  await chrome.storage.local.set({ openaiKey: k });
  $('#key').value = ''; $('#keybox').open = false;
  say('Key saved.', true);
});

$('#inspect').addEventListener('click', async () => {
  say('Reading the platform…');
  const r = await send({ type: 'discover' });
  if (!r.ok) return say(r.why);
  const p = r.profile;
  $('#platform').textContent = `${p.libraryEntries.length} element types · commits with "${p.commit.control}"`;
  say(`Found ${p.libraryEntries.length} element types: ${p.libraryEntries.join(', ')}\n\n` +
      `Commits with "${p.commit.control}"` +
      (p.commit.decoys.length ? `, rejecting ${p.commit.decoys.join(', ')}` : '') +
      (p.reuse.canImport ? `\nForms can be reused via "${p.reuse.importControl}"` : '') +
      (p.gaps.length ? `\n\nCould not determine: ${p.gaps.join('; ')}` : ''), true);
});

$('#start').addEventListener('click', async () => {
  clearSay();
  const planned = await send({ type: 'plan', ir });
  if (!planned.ok) return say(planned.why);
  say(`Planned ${planned.steps} steps.`, true);
  $('#progress').hidden = false; $('#queue').hidden = false;
  send({ type: 'run' }).then(finish);
  timer = setInterval(poll, 700);
});

$('#stop').addEventListener('click', () => send({ type: 'stop' }));

async function poll() {
  const s = await send({ type: 'status' });
  if (!s.ok) return;
  const pct = s.total ? Math.round((s.cursor / s.total) * 100) : 0;
  $('#fill').style.width = pct + '%';
  $('#counts').textContent = `${s.cursor} of ${s.total} steps · ${s.gate.length} awaiting a decision`;
  renderQueue(s.gate);
  if (!s.running) { clearInterval(timer); }
}

function renderQueue(items) {
  const list = items;
  $('#qhead').textContent = list.length ? `— ${list.length} to clear` : '— nothing outstanding';
  $('#items').textContent = '';
  for (const g of list) {
    const el = document.createElement('div');
    el.className = 'item ' + (g.severity?.blocking ? 'block' : 'flag');
    el.append(tag(g.severity?.blocking ? 'blocking' : 'flagged', g.severity?.label));
    el.append(node('div', 'q', g.question || g.why));
    if (g.severity?.cost) el.append(node('div', 'cost', g.severity.cost));
    if (g.affects > 1) {
      el.append(node('div', 'affects',
        `Applies to ${g.affects} places: ` + g.occurrences.slice(0, 4)
          .map((o) => [o.visit, o.form, o.name].filter(Boolean).join(' › ')).join(' · ') +
        (g.affects > 4 ? ` and ${g.affects - 4} more` : '')));
    } else if (g.occurrences?.[0]?.irPath) {
      el.append(node('div', 'affects', g.occurrences[0].irPath));
    }
    for (const [k, v] of Object.entries(g.evidence || {})) {
      el.append(node('div', 'ev', `${k}:\n  ` + [].concat(v).join('\n  ')));
    }
    const opts = document.createElement('div'); opts.className = 'opts';
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

function tag(kind, label) {
  const s = document.createElement('span'); s.className = 'tag';
  s.textContent = `${kind} · ${label || ''}`.trim(); return s;
}
function node(t, cls, text) { const n = document.createElement(t); n.className = cls; n.textContent = text; return n; }

async function finish(r) {
  clearInterval(timer);
  const s = await send({ type: 'status' });
  renderQueue(s.gate || []);
  const rec = await send({ type: 'trace' });
  if (rec.ok) {
    record = rec;
    $('#done').hidden = false;
    $('#record').textContent = rec.narrative;
  }
}

const dl = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  chrome.downloads ? chrome.downloads.download({ url, filename: name })
                   : Object.assign(document.createElement('a'), { href: url, download: name }).click();
};
$('#dljson').addEventListener('click', () => record && dl('study-build-record.json', JSON.stringify(record.record, null, 2), 'application/json'));
$('#dltxt').addEventListener('click', () => record && dl('study-build-summary.txt', record.narrative, 'text/plain'));

// Exposed so the reviewer UI can be previewed outside Chrome (tools/preview).
window.renderQueue = renderQueue;
