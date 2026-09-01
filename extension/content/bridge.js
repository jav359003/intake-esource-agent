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
          case 'plan':      reply({ ok: true, ...(await R.buildPlan(msg.ir)) }); break;
          case 'run':       reply({ ok: true, ...(await R.execute(msg.options || {})) }); break;
          case 'status':    reply({ ok: true, ...R.status() }); break;
          case 'resolve':   reply({ ok: true, ...R.resolveGate(msg.id, msg.answer) }); break;
          case 'stop':      R.stop(); reply({ ok: true }); break;
          default:          reply({ ok: false, why: `unknown message ${msg.type}` });
        }
      } catch (e) { reply({ ok: false, why: String(e && e.message || e) }); }
    })();
    return true;                      // async reply
  });
})();
