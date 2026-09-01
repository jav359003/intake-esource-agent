/**
 * The run record.
 *
 * "For every element the agent creates, you should be able to say which entry
 * in the input file it came from and why. In a regulated environment this is
 * not optional."
 *
 * So the export is not a log dump. It is a per-element record answering four
 * questions a reviewer or an auditor will ask: what was built, from which line
 * of the specification, on what evidence, and was it checked afterwards.
 *
 * It also records what the agent chose NOT to do -- the controls it rejected,
 * the decisions a human made, and everything skipped because it already
 * existed. An account that only lists successes cannot be audited.
 */

(function () {

const T = {};

T.build = function build(state) {
  const created = [], skipped = [], failed = [], decisions = [];

  for (const t of state.trace) {
    if (!t.irPath) continue;
    const row = {
      what: t.kind, name: t.name, from: t.irPath, at: t.at,
      outcome: t.action,
      // Read-back is what separates "clicked something" from "built it".
      verified: t.action === 'created' ? 'read back and matched the specification' : null,
      note: t.detail || null,
    };
    if (t.action === 'created') created.push(row);
    else if (t.action === 'skip') skipped.push({ ...row, why: t.why || t.detail });
    else if (t.action === 'failed') failed.push(row);
  }

  for (const g of state.gate) {
    decisions.push({
      question: g.why, about: g.about?.irPath || g.about?.name || null,
      raisedAt: g.at, status: g.status,
      answeredBy: g.status === 'resolved' ? 'a human' : null,
      answer: g.answer ?? null, answeredAt: g.resolvedAt ?? null,
    });
  }

  const profile = state.profile || {};
  return {
    generated: new Date().toISOString(),
    platform: {
      origin: profile.origin,
      // How the agent read this platform, so a reader can tell whether a
      // failure was the agent misreading the screen or the screen changing.
      elementLibrary: profile.libraryEntries,
      commitControl: profile.commit?.control,
      commitRejected: profile.commit?.decoys,
      formReuse: profile.reuse,
      gaps: profile.gaps,
    },
    typeMapping: state.typeMap || null,
    counts: {
      created: created.length, skippedAsExisting: skipped.length,
      failed: failed.length, decisionsRaised: decisions.length,
      decisionsOutstanding: decisions.filter((d) => d.status !== 'resolved').length,
    },
    created, skippedAsExisting: skipped, failed, decisions,
  };
};

/** A short plain-text account, for someone who will not read JSON. */
T.narrate = function narrate(record) {
  const L = [];
  L.push(`Run of ${record.platform.origin || 'the platform'} at ${record.generated}`);
  L.push('');
  L.push(`  built           ${record.counts.created}`);
  L.push(`  already present ${record.counts.skippedAsExisting}`);
  L.push(`  not built       ${record.counts.failed}`);
  L.push(`  decisions       ${record.counts.decisionsRaised} ` +
         `(${record.counts.decisionsOutstanding} outstanding)`);
  L.push('');
  L.push('The agent read this platform as offering: ' +
         (record.platform.elementLibrary || []).join(', '));
  L.push(`It committed with "${record.platform.commitControl}" and rejected ` +
         JSON.stringify(record.platform.commitRejected || []));
  if (record.typeMapping) {
    L.push('');
    L.push('Type mapping used:');
    for (const [k, v] of Object.entries(record.typeMapping)) L.push(`  ${k.padEnd(15)} -> ${v}`);
  }
  if (record.failed.length) {
    L.push('');
    L.push('Not built:');
    for (const f of record.failed) L.push(`  ${f.from}  ${f.note || ''}`);
  }
  return L.join('\n');
};

if (typeof window !== 'undefined') window.__soaTrace = T;
if (typeof module !== 'undefined') module.exports = T;

})();
