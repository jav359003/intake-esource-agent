/**
 * The human gate: what gets asked, how it is grouped, and what a reviewer sees.
 *
 * Two failure modes bound this design, and they pull in opposite directions.
 * A tool that quietly guesses is worse than useless, because a wrong field type
 * discovered after go-live costs more than building the study by hand. A tool
 * that asks about all 195 fields has also saved nobody any time.
 *
 * So the queue is built on three rules:
 *
 *   1. Ask once per DECISION, not once per occurrence. "Vital Signs appears at
 *      four visits" is one question. A type mapping is one question for the
 *      whole study, not one per field of that type.
 *   2. Rank by consequence. A wrong type is a database column that has to be
 *      migrated after patients are enrolled in it; a missing placeholder is
 *      cosmetic. Cost of being wrong drives the order, not arrival time.
 *   3. Show the evidence, not the verdict. Every item carries what the agent
 *      saw, what it nearly chose instead, and which line of the input it came
 *      from -- so a reviewer can decide in seconds without opening the platform.
 */

(function () {

const G = {};

/**
 * How expensive is it to get this wrong? Drives ordering, and which items
 * block the build rather than merely being flagged.
 */
const SEVERITY = {
  'type-map':       { rank: 1, blocking: true,  label: 'Field type',
                      cost: 'A wrong type is a database column migrated after patients are enrolled.' },
  // A confirmation, not a blocker: the mapping is confident, but these are the
  // pairs most often mapped the wrong way round, so a person sees them once.
  'type-map-confirm': { rank: 2, blocking: false, label: 'Confirm type mapping',
                      cost: 'One answer covers every field of these types in the study.' },
  'coded-values':   { rank: 2, blocking: true,  label: 'Coded values',
                      cost: 'Labels without codes look right and store the wrong thing.' },
  'skip-logic':     { rank: 3, blocking: false, label: 'Visibility rule',
                      cost: 'A rule that never fires shows a field to everyone, or to nobody.' },
  'persistence':    { rank: 4, blocking: true,  label: 'Not saved',
                      cost: 'Work that looked finished is not in the study.' },
  'build':          { rank: 5, blocking: false, label: 'Field not built',
                      cost: 'A missing field is data nobody collects.' },
  'navigation':     { rank: 6, blocking: false, label: 'Could not reach',
                      cost: 'Everything below this point was skipped.' },
  'input-problem':  { rank: 7, blocking: false, label: 'Input',
                      cost: 'The specification refers to something that is not there.' },
  'not-implemented':{ rank: 8, blocking: false, label: 'Unsupported',
                      cost: 'This platform cannot express it.' },
  'save':           { rank: 4, blocking: true,  label: 'Not saved', cost: 'Work is not in the study.' },
  'crash':          { rank: 9, blocking: false, label: 'Failure', cost: 'The agent stopped here.' },
};

/** Two escalations are the same question if the same answer resolves both. */
function questionKey(item) {
  const a = item.about || {};
  if (item.kind === 'type-map') return `type:${a.type || a.canonical}`;
  if (item.kind === 'type-map-confirm') return 'type-map-confirm';
  if (item.kind === 'skip-logic') return `rule:${a.form}:${a.name}`;
  if (item.kind === 'build') return `field:${a.form}:${a.name}:${String(item.why).slice(0, 40)}`;
  if (item.kind === 'navigation') return `nav:${a.visit || ''}:${a.form || ''}`;
  return `${item.kind}:${a.form || ''}:${a.name || ''}:${String(item.why).slice(0, 40)}`;
}

/**
 * Collapse the raw escalations into a reviewer's worklist.
 *
 * The count matters as much as the item: "this affects 4 forms" tells a
 * reviewer how much rides on the answer.
 */
G.build = function build(escalations) {
  const groups = new Map();
  for (const e of escalations) {
    if (e.status === 'resolved') continue;
    const key = questionKey(e);
    if (!groups.has(key)) {
      const sev = SEVERITY[e.kind] || SEVERITY.crash;
      groups.set(key, {
        key, kind: e.kind, severity: sev, question: null,
        why: e.why, evidence: pickEvidence(e), occurrences: [], ids: [],
      });
    }
    const g = groups.get(key);
    g.occurrences.push({
      visit: e.about?.visit, form: e.about?.form, name: e.about?.name, irPath: e.about?.irPath,
    });
    g.ids.push(e.id);
  }

  const list = [...groups.values()].map((g) => ({
    ...g,
    affects: g.occurrences.length,
    question: phrase(g),
    options: options(g),
  }));

  // Blocking first, then by cost of being wrong, then by how much rides on it.
  list.sort((a, b) =>
    Number(b.severity.blocking) - Number(a.severity.blocking) ||
    a.severity.rank - b.severity.rank ||
    b.affects - a.affects);
  return list;
};

function pickEvidence(e) {
  const ev = {};
  if (e.candidates) ev['the agent considered'] = e.candidates;
  if (e.available) ev['the platform offered'] = e.available;
  if (e.sawInstead) ev['what was on screen'] = e.sawInstead;
  if (e.diffs) ev['read back as'] = e.diffs.map((d) => `${d.what}: wanted ${JSON.stringify(d.expected)}, found ${JSON.stringify(d.actual)}`);
  if (e.missing) ev['missing after saving'] = e.missing;
  if (e.trail) ev['last actions'] = e.trail;
  if (e.wanted && e.got) ev['rule'] = [`wanted ${JSON.stringify(e.wanted)}`, `got ${JSON.stringify(e.got)}`];
  if (e.notOffered) ev['no control for'] = e.notOffered;
  return ev;
}

function phrase(g) {
  const one = g.occurrences[0] || {};
  switch (g.kind) {
    case 'type-map':   return `Which element should "${one.name || g.key.split(':')[1]}" fields use?`;
    case 'type-map-confirm':
      return 'These are the pairs most often mapped the wrong way round. Do they look right?';
    case 'skip-logic': return `Could not set the visibility rule on "${one.name}". Set it by hand, or skip it?`;
    case 'build':      return `"${one.name}" was not built. Retry, or leave it out?`;
    case 'persistence':
    case 'save':       return `"${one.form}" may not have saved. Check it, or retry?`;
    case 'navigation': return `Could not reach ${one.form ? `"${one.form}"` : `"${one.visit}"`}. Retry?`;
    default:           return g.why;
  }
}

function options(g) {
  switch (g.kind) {
    case 'type-map':   return ['use the agent\'s choice', 'use the runner-up', 'pick another'];
    case 'type-map-confirm': return ['yes, these are right', 'no, let me change one'];
    case 'skip-logic': return ['I set it by hand', 'build without the rule', 'retry'];
    case 'build':      return ['retry', 'leave it out', 'I built it by hand'];
    case 'persistence':
    case 'save':       return ['retry the save', 'I checked, it is there', 'stop the run'];
    default:           return ['retry', 'skip', 'stop the run'];
  }
}

/** Everything a reviewer needs to clear the queue, without opening the platform. */
G.summary = function summary(list) {
  const blocking = list.filter((g) => g.severity.blocking);
  return {
    questions: list.length,
    blocking: blocking.length,
    affected: list.reduce((n, g) => n + g.affects, 0),
    // The number that matters: how many decisions stand between a reviewer and
    // a finished study.
    headline: list.length === 0
      ? 'Nothing needs a decision.'
      : `${list.length} decision${list.length === 1 ? '' : 's'} covering ` +
        `${list.reduce((n, g) => n + g.affects, 0)} item${list.length === 1 ? '' : 's'}` +
        (blocking.length ? `, ${blocking.length} blocking` : ''),
  };
};

G.SEVERITY = SEVERITY;
if (typeof window !== 'undefined') window.__soaGate = G;
if (typeof module !== 'undefined') module.exports = G;

})();
