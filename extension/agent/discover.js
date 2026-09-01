/**
 * Learning the platform, once.
 *
 * The expensive-looking number in this assignment is 195 fields times roughly
 * six actions each: about twelve hundred steps. Asking a model what to do at
 * each one is unaffordable and slow. It is also unnecessary, because the steps
 * are the same every time -- what differs between platforms is not the
 * PROCEDURE but the VOCABULARY.
 *
 * So the procedure is written once, in buildfield.js, as queries that carry
 * meanings rather than names. Discovery supplies the handful of facts that
 * procedure needs about this particular platform:
 *
 *   - what the element library actually offers, so types can be mapped
 *   - whether forms can be reused across visits, or must be rebuilt
 *   - whether a form can be marked repeating, and how
 *   - which control commits, and which merely looks like it
 *
 * That is a few model calls per platform instead of one per action. A model is
 * consulted only where MEANING must be judged; navigation and typing need no
 * model at all.
 *
 * Everything here is a question asked of the page. Nothing is assumed about
 * what the answers will be.
 */

(function () {

const D = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The element library: a group of controls whose names are the type names the
 * platform offers.
 *
 * Found structurally rather than by container name. A library is a cluster of
 * same-role controls that share a region and are not the page's chrome, so the
 * biggest such cluster on a form designer is the library. On a platform that
 * calls the panel "Widgets" or "Palette" this still finds it.
 */
D.findElementLibrary = function findElementLibrary(act) {
  const snap = window.__soaPerceive.snapshot();
  const buttons = snap.controls.filter((c) => c.role === 'button' && c.name);

  const groups = new Map();
  for (const b of buttons) {
    const key = b.region.join(' > ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }

  let best = null;
  for (const [region, items] of groups) {
    // Chrome and toolbars are small; a type library is long. Require enough
    // members that a nav bar cannot win.
    if (items.length < 6) continue;
    // Library entries are short noun phrases, not sentences, and they are not
    // the same word repeated.
    const avgWords = items.reduce((n, i) => n + i.name.split(/\s+/).length, 0) / items.length;
    if (avgWords > 4) continue;
    const distinct = new Set(items.map((i) => i.name.toLowerCase())).size;
    if (distinct < items.length * 0.9) continue;
    const score = items.length + (region.toLowerCase().includes('element') ? 2 : 0);
    if (!best || score > best.score) {
      best = { region, score, entries: items.map((i) => i.name) };
    }
  }
  return best;
};

/**
 * Does this platform let a form definition be reused at another visit?
 *
 * Seventeen definitions appear at twenty-eight visits, so the answer changes
 * how much work there is and whether the same form built twice is a duplicate
 * or a reuse. The assignment says to find out rather than assume, and both
 * assumptions are wrong on some platform: rebuilding when reuse exists makes
 * twenty-eight definitions where the sponsor expects seventeen; reusing when
 * it does not exist silently drops forms.
 *
 * The question is asked of the page: is there any affordance that pulls an
 * existing definition in?
 */
D.detectFormReuse = function detectFormReuse(act) {
  const hit = act.resolve({
    role: ['button', 'link'],
    name: ['import from library', 'import', 'from template', 'use template',
           'copy from', 'reuse', 'add existing', 'from library'],
    minScore: 0.5,
  });
  const save = act.resolve({
    role: 'button',
    name: ['save as template', 'save to library', 'add to library'],
    minScore: 0.6,
  });
  return {
    canImport: hit.ok,
    importControl: hit.ok ? hit.control.name : null,
    canPublishTemplate: save.ok,
    templateControl: save.ok ? save.control.name : null,
    // Deliberately NOT decided here. Whether to reuse is a study-level policy
    // question with a clinical consequence, so it goes to the human once.
    decision: 'unresolved',
  };
};

/** Can a form be marked as a repeating log, and by what control? */
D.detectRepeating = function detectRepeating(act) {
  const hit = act.resolve({
    role: ['checkbox', 'switch', 'combobox'],
    name: ['repeating', 'repeats', 'log', 'multiple records', 'many records',
           'allow multiple', 'grid'],
    minScore: 0.45,
  });
  return { supported: hit.ok, control: hit.ok ? hit.control.name : null };
};

/**
 * Which control commits, and what else is pretending to.
 *
 * Reported as a set rather than a single answer. This platform puts "Save As
 * Template" beside "Save" and colours the template one more prominently; the
 * decoys are worth recording so the human gate can show what was rejected and
 * why, instead of just asserting a choice.
 */
D.detectCommit = function detectCommit(act) {
  const P = window.__soaPersist;
  const all = act.find({ role: 'button', name: ['save', 'apply', 'commit', 'done', 'publish', 'activate'] });
  const chosen = act.resolve(P.Q.save);
  return {
    control: chosen.ok ? chosen.control.name : null,
    confident: chosen.ok && chosen.confident,
    margin: chosen.margin ?? null,
    decoys: all.filter((c) => !chosen.ok || c.id !== chosen.control.id)
               .slice(0, 5).map((c) => c.name),
  };
};

/**
 * Build a profile of the platform from a form-builder screen.
 *
 * Cached by origin. The profile is facts about vocabulary and capability --
 * never element ids, never positions, nothing that would stop working if the
 * markup changed.
 */
D.profile = function profile(act, { origin = location.origin } = {}) {
  const library = D.findElementLibrary(act);
  const reuse = D.detectFormReuse(act);

  // A library panel usually carries controls that are not element types --
  // this one ends with "Import From Library…", which sits in the same group
  // and would otherwise be offered to the type mapper as a thirteenth type.
  // Anything already identified as a different affordance is removed, and
  // anything shaped like an action rather than a noun is dropped: type names
  // are nouns ("Dropdown", "Date"), commands trail off or start with a verb.
  const ACTIONISH = /^(import|add|new|create|insert|browse|choose|select|upload|more)\b|[.…]{1,3}$/i;
  const entries = (library?.entries ?? []).filter((e) => {
    if (reuse.importControl && e === reuse.importControl) return false;
    if (reuse.templateControl && e === reuse.templateControl) return false;
    return !ACTIONISH.test(e.trim());
  });
  const dropped = (library?.entries ?? []).filter((e) => !entries.includes(e));
  const p = {
    origin,
    observedAt: new Date().toISOString(),
    libraryRegion: library?.region ?? null,
    libraryEntries: entries,
    libraryNonTypes: dropped,
    reuse,
    repeating: D.detectRepeating(act),
    commit: D.detectCommit(act),
    gaps: [],
  };
  if (!library) p.gaps.push('no element library found on this screen; type mapping cannot proceed');
  if (!p.commit.control) p.gaps.push('no control identified that commits the form');
  if (!p.commit.confident) {
    p.gaps.push(`several controls could be the commit (margin ${p.commit.margin}); ` +
                `chose "${p.commit.control}" over ${JSON.stringify(p.commit.decoys)}`);
  }
  return p;
};

D.sleep = sleep;
if (typeof window !== 'undefined') window.__soaDiscover = D;
if (typeof module !== 'undefined') module.exports = D;

})();
