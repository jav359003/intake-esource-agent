/**
 * Committing a form, and proving it committed.
 *
 * A form designer holds a working copy. Everything the agent typed into the
 * options panel reads back perfectly from that working copy and is worth
 * nothing until something persists it -- the first full run of this agent
 * built and verified all eight Demographics fields, and the platform's saved
 * study contained `"fields": []`. Read-back against the editor is not
 * verification; it is verification of the editor.
 *
 * So persistence is proved the only way that does not depend on a debug hook
 * or on trusting a button: leave the screen and come back. If the fields are
 * there after a round trip, they are in the store. If they are not, they never
 * were, whatever the click appeared to do.
 */
// Wrapped in its own scope: Chrome evaluates every content script in one
// shared world, so two files declaring `const sleep` at top level is a
// SyntaxError that kills both.
(function () {

const P = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Controls that look like the one you want and are not.
 *
 * This platform puts "Save As Template" immediately beside "Save", and makes
 * the template one the more prominent colour. Preview and Activate sit in the
 * same row. None of these names is hardcoded as a target -- they are named
 * here as things to score DOWN, which is the opposite of a selector: if a
 * platform has none of them, nothing is lost.
 */
const NOT_A_SAVE = ['template', 'preview', 'activate', 'publish', 'cancel',
                    'discard', 'delete', 'export', 'copy', 'duplicate'];

const Q = {
  save:    { role: 'button', name: ['save', 'apply', 'commit', 'done'], notName: NOT_A_SAVE },
  // Getting out of the builder. Breadcrumbs are commonly named after their
  // DESTINATION rather than the act of leaving -- this platform's control is
  // "← Screening", the visit the form belongs to. The agent already knows that
  // name, so it is passed in as a synonym rather than guessed at.
  leave:   { role: ['button', 'link'], name: ['back', 'close', 'return', 'exit', 'schedule', 'documents'] },
  reopen:  { role: 'button', name: ['edit', 'open', 'design', 'build', 'configure'] },
};

/**
 * Is a field with this label actually drawn on the page?
 *
 * The first version of this read the Options panel's Label input, which shows
 * only the currently selected element -- so after re-opening a saved form with
 * nothing selected it read zero fields and declared that all eight had been
 * lost, while the platform's own store held all eight correctly. Verifying
 * against the editor's inspector is not verifying the form.
 *
 * A builder canvas draws the fields the form holds, and each drawn field
 * carries its label as its accessible name. For coded fields the name is
 * "<label>: <option>", one control per option. So a field is present if any
 * control on the page is named for it, exactly or as the prefix of an option.
 */
P.presentLabels = function presentLabels(expected) {
  const snap = window.__soaPerceive.snapshot();
  const names = snap.controls.map((c) => (c.name || '').trim()).filter(Boolean);
  const found = new Set();
  for (const label of expected) {
    const l = label.trim().toLowerCase();
    const hit = names.some((n) => {
      const x = n.trim().toLowerCase();
      return x === l || x.startsWith(l + ':') || x.startsWith(l + ' :');
    });
    if (hit) found.add(label);
  }
  return found;
};

P.save = async function save(ctx) {
  const { act, log } = ctx;
  const hit = act.resolve(Q.save);
  if (!hit.ok) return { ok: false, why: `no control that commits the form: ${hit.reason}` };
  if (!hit.confident) {
    return { ok: false, escalate: true,
             why: `several controls could be the save (margin ${hit.margin})`,
             candidates: hit.candidates.map((c) => `${c.name} (${c.score})`) };
  }
  log('save', { clicked: hit.control.name, runnerUp: hit.candidates[1]?.name ?? null });
  act.click(hit.control.id);
  await sleep(ctx.settle * 4);
  return { ok: true, clicked: hit.control.name };
};

/**
 * Prove the form persisted by round-tripping through another screen.
 *
 * Expected labels are compared as a set, and anything missing is named. A
 * count match is not enough: a form that saved five of eight fields and a form
 * that saved the wrong five look identical by count.
 */
P.verifyPersisted = async function verifyPersisted(expectedLabels, ctx) {
  const { act, log } = ctx;

  const before = P.presentLabels(expectedLabels).size;
  const leaveQuery = ctx.parentName
    ? { ...Q.leave, name: [...Q.leave.name, ctx.parentName] }
    : Q.leave;
  const away = act.resolve(leaveQuery);
  if (!away.ok) return { ok: false, why: `cannot leave the builder to test persistence: ${away.reason}` };
  act.click(away.control.id);
  await sleep(ctx.settle * 5);

  const back = act.resolve(Q.reopen);
  if (!back.ok) return { ok: false, why: `cannot re-open the form: ${back.reason}` };
  act.click(back.control.id);
  await sleep(ctx.settle * 6);

  const after = P.presentLabels(expectedLabels);
  const missing = expectedLabels.filter((l) => !after.has(l));
  const extra = [];
  log('persistence-check', { expected: expectedLabels.length, beforeLeaving: before,
                             afterReturning: after.size, missing: missing.length });

  if (missing.length) {
    return { ok: false, escalate: true,
             why: `${missing.length} of ${expectedLabels.length} fields did not survive leaving and re-opening the form`,
             missing, extra };
  }
  return { ok: true, persisted: after.size, extra };
};

P.Q = Q;
P.NOT_A_SAVE = NOT_A_SAVE;
if (typeof window !== 'undefined') window.__soaPersist = P;
if (typeof module !== 'undefined') module.exports = P;

})();
