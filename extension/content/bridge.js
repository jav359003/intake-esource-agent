/**
 * The only thing that talks to the extension. Everything else is a plain
 * module that could be run from a console, which is what let all of it be
 * developed and tested against the live platform before any of it was
 * packaged.
 */
(function () {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    const R = window.__soaRun;
    if (!R) { reply({ ok: false, why: 'agent modules not loaded on this page' }); return; }
    (async () => {
      try {
        switch (msg.type) {
          case 'ping':      reply({ ok: true, url: location.href, title: document.title }); break;
          case 'discover':  reply({ ok: true, profile: R.discover() }); break;
          case 'typemap':   reply(await R.ensureTypeMap(R.state.ctx || {})); break;
          case 'plan':      reply({ ok: true, ...(await R.buildPlan(msg.ir)) }); break;
          case 'run':       reply({ ok: true, ...(await R.execute(msg.options || {})) }); break;
          case 'status':    reply({ ok: true, ...R.status(),
                                    gate: window.__soaGate.build(R.status().gate) }); break;
          case 'trace': {
            const rec = window.__soaTrace.build(R.state);
            reply({ ok: true, record: rec, narrative: window.__soaTrace.narrate(rec) });
            break;
          }
          case 'resolve':   reply({ ok: true, ...R.resolveGate(msg.id, msg.answer) }); break;
          case 'stop':      R.stop(); reply({ ok: true }); break;
          default:          reply({ ok: false, why: `unknown message ${msg.type}` });
        }
      } catch (e) {
        // A stack is what makes a panel error actionable; the message alone
        // ("Cannot read properties of null") says nothing about where.
        reply({ ok: false, why: String((e && e.message) || e),
                where: String((e && e.stack) || '').split('\n').slice(1, 4).join('\n') });
      }
    })();
    return true;                      // async reply
  });
})();
