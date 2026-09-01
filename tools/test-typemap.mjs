// Validate the type-mapping prompt against a real element library, outside the
// extension. Two model calls, cached to disk, so iterating on the prompt does
// not re-spend.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { SYSTEM, buildPrompt, triage } = require('../extension/agent/typemap.js');

const env = Object.fromEntries(
  readFileSync(process.env.HOME + '/Desktop/IntakeAI/.env', 'utf8')
    .split('\n').filter(Boolean).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));

const library = JSON.parse(process.argv[2] || '[]');
const prompt = buildPrompt(library);
const key = createHash('sha256').update(SYSTEM + prompt).digest('hex').slice(0, 16);
mkdirSync('cache', { recursive: true });
const cacheFile = `cache/typemap_${key}.json`;

let result;
if (existsSync(cacheFile)) {
  result = JSON.parse(readFileSync(cacheFile, 'utf8'));
  console.log('(cached)');
} else {
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-5', instructions: SYSTEM,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      max_output_tokens: 8000, text: { format: { type: 'json_object' } },
    }),
  });
  const j = await r.json();
  if (!r.ok) { console.error(JSON.stringify(j).slice(0, 600)); process.exit(1); }
  const text = (j.output || []).flatMap((o) => o.content || []).map((c) => c.text).filter(Boolean).join('');
  result = JSON.parse(text);
  result._usage = j.usage;
  writeFileSync(cacheFile, JSON.stringify(result, null, 2));
}

console.log('\nMAPPINGS');
for (const m of result.mappings || []) {
  const flag = m.confidence < 0.85 ? ' LOW' : '';
  const conf = (m.confusable_with || []).length ? `  confusable: ${m.confusable_with.join(',')}` : '';
  console.log(`  ${m.canonical.padEnd(14)} -> ${String(m.library_entry).padEnd(22)} ${m.confidence}${flag}` +
              `  (runner-up: ${m.runner_up ?? '—'})${conf}`);
}
if ((result.unmapped || []).length) {
  console.log('\nUNMAPPED');
  for (const u of result.unmapped) console.log(`  ${u.canonical}: ${u.why}`);
}
const t = triage(result);
console.log(`\nAUTO-ACCEPTED: ${t.autoAccepted} of ${(result.mappings||[]).length}`);
console.log(`BLOCKING (${t.blocking.length}) — nothing is built with these until a human rules`);
for (const q of t.blocking) console.log(`  ${(q.canonical || '?').padEnd(14)} ${q.why}`);
console.log(`\nCONFIRM (${t.confirm.length} card${t.confirm.length === 1 ? '' : 's'}) — one click, applies study-wide`);
for (const c of t.confirm) {
  console.log('  ' + c.why);
  for (const r of c.rows) console.log(`     ${r.pair[0]} -> ${r.entries[0]}   |   ${r.pair[1]} -> ${r.entries[1]}`);
}
if (result.notes?.length) { console.log('\nNOTES'); result.notes.forEach((n) => console.log('  - ' + n)); }
