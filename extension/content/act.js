/**
 * Acting: do something to a control that was found semantically.
 *
 * Controls are addressed by what they ARE -- a role, and a name that means the
 * right thing -- never by where they sit in the DOM. `find` scores candidates
 * and returns the ranked list rather than a single answer, because "no
 * confident match" and "two equally good matches" are both real outcomes that
 * the agent must be able to escalate instead of guessing between.
 *
 * Every action re-snapshots first. A snapshot id from before the last click is
 * stale by definition, and reusing one is how an agent ends up clicking
 * whatever moved into that position.
 */
// Wrapped in its own scope: Chrome evaluates every content script in one
// shared world, so two files declaring `const sleep` at top level is a
// SyntaxError that kills both.
(function () {

const A = {};

/** Word-level containment score, so "Save" matches "Save Visit" but not "Save As Template" exactly. */
function nameScore(actual, want) {
  const a = actual.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const w = want.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!a || !w) return 0;
  if (a === w) return 1;
  const aw = a.split(' '), ww = w.split(' ');
  const hit = ww.filter((t) => aw.includes(t)).length;
  if (!hit) return 0;
  // Recall of the wanted words, penalised by how much extra the actual name
  // carries. "Save As Template" scores below "Save" for want="save" because of
  // the extra words -- which is exactly the trap this platform sets.
  const recall = hit / ww.length;
  const extra = Math.max(0, aw.length - ww.length);
  return recall * (1 / (1 + extra * 0.6));
}

/**
 * Find controls matching a semantic query.
 *
 *   { role: 'button', name: 'save', notName: 'template', region: 'Elements' }
 *
 * `name` may be a string or a list of synonyms -- the caller supplies meanings
 * ("save", "publish", "apply"), not one platform's wording.
 */
/**
 * How closely two controls are related in the document, by shared ancestry.
 *
 * The control that commits a dialog lives inside that dialog, next to the
 * fields it commits. Without this, "save" on a page that also offers "+ Add
 * Visit" is a coin flip -- both score identically on their names alone, and
 * the agent has no reason to prefer the one it just filled fields in.
 * Proximity in the document is the platform-independent tiebreak.
 */
function affinity(aEl, bEl) {
  if (!aEl || !bEl) return 0;
  let depth = 0;
  for (let n = aEl; n && depth < 12; n = n.parentElement, depth++) {
    if (n.contains(bEl)) return 1 / (1 + depth);   // 1.0 siblings, decaying outward
  }
  return 0;
}

A.find = function find(query, snap) {
  const s = snap || window.__soaPerceive.snapshot();
  // `near` is a QUERY, not an id: it is resolved against this same snapshot.
  // Passing an id from an earlier snapshot would point at whatever has since
  // taken that position.
  let nearEl = null;
  if (query.near) {
    const anchor = A.find({ ...query.near, near: undefined }, s)[0];
    if (anchor) nearEl = window.__soaPerceive.nodeFor(anchor.id);
  }
  const wants = [].concat(query.name || []);
  const avoid = [].concat(query.notName || []);
  const roles = [].concat(query.role || []);

  const scored = [];
  for (const c of s.controls) {
    if (roles.length && !roles.includes(c.role)) continue;
    if (query.region) {
      // A list of synonyms, like every other name in a query: the sub-panel
      // holding coded values is called "Values" here and "Choices" or "Codes"
      // elsewhere.
      const wantedRegions = [].concat(query.region);
      const inRegion = wantedRegions.some((w) => c.region.some((r) => nameScore(r, w) > 0.4));
      if (!inRegion) continue;
    }
    if (query.notRegion) {
      // Exclusion uses a much stricter bar than inclusion, because a wrong
      // exclusion removes the only correct control and the query then matches
      // nothing at all. "options list" scored 0.5 against the region actually
      // named "Options" and eliminated every field-level property on the page.
      const banned = [].concat(query.notRegion)
        .some((b) => c.region.some((r) => nameScore(r, b) >= 0.85));
      if (banned) continue;
    }
    let score = wants.length ? Math.max(...wants.map((w) => nameScore(c.name, w))) : 0.5;
    if (!score) continue;
    for (const bad of avoid) {
      if (nameScore(c.name, bad) > 0.3) score *= 0.15;   // demote, never delete
    }
    if (c.state?.disabled) score *= 0.3;
    if (nearEl) {
      const aff = affinity(nearEl, window.__soaPerceive.nodeFor(c.id));
      score *= 1 + aff;              // up to 2x for a control in the same block
    }
    scored.push({ ...c, score: Number(score.toFixed(3)) });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored;
};

/** The single best match, plus whether it was actually unambiguous. */
A.resolve = function resolve(query, snap) {
  const hits = A.find(query, snap);
  if (!hits.length) return { ok: false, reason: 'no control matched', candidates: [] };
  const [best, second] = hits;
  const margin = second ? best.score - second.score : best.score;
  const bar = query.minScore ?? 0.45;
  return {
    ok: best.score >= bar,
    reason: best.score >= bar ? undefined
      : `best match "${best.name}" scored ${best.score}, below the ${bar} bar`,
    confident: best.score >= 0.6 && margin >= 0.15,
    control: best,
    margin: Number(margin.toFixed(3)),
    candidates: hits.slice(0, 4),
  };
};

function node(id) {
  const n = window.__soaPerceive.nodeFor(id);
  if (!n) throw new Error(`control ${id} is no longer on the page`);
  return n;
}

A.click = function click(id) {
  const n = node(id);
  n.scrollIntoView({ block: 'center' });
  n.click();
  return true;
};

A.fill = function fill(id, value) {
  const n = node(id);
  n.focus();
  // Set through the native setter so frameworks that watch the property (React
  // and friends) see the change. Dispatching input alone is not enough.
  const proto = n instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(n, String(value)); else n.value = String(value);
  n.dispatchEvent(new Event('input', { bubbles: true }));
  n.dispatchEvent(new Event('change', { bubbles: true }));
  n.blur();
  return true;
};

A.setChecked = function setChecked(id, want) {
  const n = node(id);
  const is = n.checked ?? n.getAttribute('aria-checked') === 'true';
  if (is !== want) n.click();
  return true;
};

/** Choose an option in a select by meaning, not by index. */
A.choose = function choose(id, wantedText) {
  const n = node(id);
  const opts = [...n.querySelectorAll('option')];
  const scored = opts
    .map((o) => ({ o, s: nameScore(o.textContent || '', wantedText) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { ok: false, reason: `no option resembling "${wantedText}"`,
                               available: opts.map((o) => (o.textContent || '').trim()) };
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  const val = scored[0].o.value;
  if (setter) setter.call(n, val); else n.value = val;
  n.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, chose: (scored[0].o.textContent || '').trim(), score: scored[0].s,
           runnerUp: scored[1] ? (scored[1].o.textContent || '').trim() : null };
};

A.nameScore = nameScore;

if (typeof window !== 'undefined') window.__soaAct = A;
if (typeof module !== 'undefined') module.exports = A;

})();
