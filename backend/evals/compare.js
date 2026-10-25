// spec 011 T11 — compara los resultados guardados en evals/results/ por proveedor y modelo (la corrida más reciente
// de cada uno): tasa de aprobación por caso, tokens y pedidos. No llama a ningún proveedor.
import { readdirSync, readFileSync, existsSync } from 'fs';

const dir = new URL('./results/', import.meta.url);
if (!existsSync(dir)) {
  console.log('[evals] todavía no hay resultados: corre `npm run evals` primero.');
  process.exit(0);
}

const latest = new Map();
for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const run = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
  latest.set(`${run.provider} / ${run.model}`, run); // orden por nombre = orden por fecha: queda la última
}

const runs = [...latest.entries()];
const cases = [...new Set(runs.flatMap(([, r]) => r.results.map((x) => x.id)))];
const rate = (run, id) => {
  const rs = run.results.filter((x) => x.id === id);
  if (!rs.length) return '—';
  const errors = rs.filter((x) => x.error).length;
  return `${rs.filter((x) => x.pass).length}/${rs.length}${errors ? ` (${errors} err)` : ''}`;
};

const header = ['caso', ...runs.map(([k]) => k)];
const rows = cases.map((id) => [id, ...runs.map(([, r]) => rate(r, id))]);
const totals = ['total', ...runs.map(([, r]) => `${r.results.filter((x) => x.pass).length}/${r.results.length}`)];
const tokens = ['tokens (entrada/salida)', ...runs.map(([, r]) => `${r.usage.input_tokens}/${r.usage.output_tokens}`)];

console.log([header, ...rows, totals, tokens].map((r) => `| ${r.join(' | ')} |`).join('\n').replace(/\n/, `\n|${header.map(() => '---').join('|')}|\n`));
