/**
 * Holds the API key and makes the model calls, because a content script cannot
 * (its requests carry the page's origin, and the key must not be readable by
 * the page it is driving).
 *
 * Model use is small by design: a platform profile and a type mapping, both
 * cached per origin. Building the 195 fields costs nothing here.
 */
const ENDPOINT = 'https://api.openai.com/v1/responses';

chrome.action.onClicked.addListener((tab) => chrome.sidePanel.open({ tabId: tab.id }));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== 'llm') return;
  (async () => {
    const { openaiKey, model = 'gpt-5' } = await chrome.storage.local.get(['openaiKey', 'model']);
    if (!openaiKey) { reply({ ok: false, why: 'no API key saved; add one in the side panel' }); return; }

    const cacheKey = `llm:${model}:${await sha(msg.system + msg.prompt)}`;
    const cached = (await chrome.storage.local.get([cacheKey]))[cacheKey];
    if (cached) { reply({ ok: true, cached: true, data: cached }); return; }

    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model, instructions: msg.system,
          input: [{ role: 'user', content: [{ type: 'input_text', text: msg.prompt }] }],
          max_output_tokens: 8000, text: { format: { type: 'json_object' } },
        }),
      });
      const j = await r.json();
      if (!r.ok) { reply({ ok: false, why: JSON.stringify(j).slice(0, 300) }); return; }
      const text = (j.output || []).flatMap((o) => o.content || []).map((c) => c.text).filter(Boolean).join('');
      const data = JSON.parse(text);
      await chrome.storage.local.set({ [cacheKey]: data });
      reply({ ok: true, cached: false, data, usage: j.usage });
    } catch (e) { reply({ ok: false, why: String(e && e.message || e) }); }
  })();
  return true;
});

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
