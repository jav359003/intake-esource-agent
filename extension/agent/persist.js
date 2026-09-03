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
const NOT_A_SAVE = ['template', 'library', 'reusable', 'preview', 'activate', 'publish',
                    'cancel', 'discard', 'delete', 'export', 'copy', 'duplicate'];

const Q = {
  save:    { role: 'button', name: ['save', 'apply', 'commit', 'done', 'save draft', 'commit draft'],
             notName: NOT_A_SAVE },
  // Getting out of the builder. Breadcrumbs are commonly named after their
  // DESTINATION rather than the act of leaving -- this platform's control is
  // "← Screening", the visit the form belongs to. The agent already knows that
  // name, so it is passed in as a synonym rather than guessed at.
  leave:   { role: ['button', 'link'], name: ['back', 'close', 'return', 'exit', 'schedule', 'documents'],
             notNav: true },
  reopen:  { role: ['button', 'link'], name: ['edit', 'open', 'design', 'build', 'configure', 'layout'],
             notNav: true, notName: ['delete', 'remove', 'retire', 'preview'] },
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

  // Widgets carry their label as an accessible name, but not uniformly: a
  // single tick and a yes/no toggle render differently from a text input, and
  // matching only on control names reported four saved fields as lost while
  // the platform's own store held all of them.
  //
  // What makes the weaker text check sound here is WHEN it runs. This is only
  // ever called after leaving the screen and coming back, so everything now
  // rendered was rebuilt from the store -- text on the page after a round trip
  // is evidence of persistence in a way that text before it would not be.
  const pageText = (document.body.innerText || '').toLowerCase();

  const found = new Set();
  for (const label of expected) {
    const l = label.trim().toLowerCase();
    const namedControl = names.some((n) => {
      const x = n.trim().toLowerCase();
      return x === l || x.startsWith(l + ':') || x.startsWith(l + ' :');
    });
    if (namedControl || pageText.includes(l)) found.add(label);
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

  // A visit holds several documents and each row has its own identical "Edit".
  // Re-opening without saying WHICH form opens the first one, whose fields are
  // not the ones just built -- every form after the first then reported that
  // all of its fields had been lost.
  const reopenQuery = ctx.formName
    ? { ...Q.reopen, near: { role: ['button', 'link', 'cell', 'gridcell', 'columnheader', 'row', 'listitem'], name: ctx.formName } }
    : Q.reopen;
  const back = act.resolve(reopenQuery);
  if (!back.ok) return { ok: false, why: `cannot re-open the form: ${back.reason}` };
  act.click(back.control.id);

  // Wait for the form to actually redraw before judging it. A fixed pause was
  // enough when driving the page directly, and not enough in Chrome with the
  // panel polling alongside -- the check read an empty canvas and reported
  // every field lost on a form the platform had saved correctly.
  const N = window.__soaNavigate;
  if (N && N.waitFor) {
    await N.waitFor(() => P.presentLabels(expectedLabels).size >= expectedLabels.length,
                    ctx, { timeout: 5000, every: 120 });
  } else {
    await sleep(ctx.settle * 6);
  }

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
