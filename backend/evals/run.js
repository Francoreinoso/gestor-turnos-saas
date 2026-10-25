// spec 011 RF-17 — evals contra el modelo REAL configurado (cualquier proveedor). Fuera de `npm test`: cada corrida
// gasta cuota del proveedor (y dinero si es de pago).
//
//   npm run evals                      todos los casos, una vez
//   npm run evals -- --repeat 3        cada caso 3 veces (los modelos no son deterministas)
//   npm run evals -- --only tema_ajeno,no_cancela_ajenos
//   npm run evals -- --timeout 180 --pause 15   capas gratuitas lentas o con pocos pedidos por minuto
//                                               (timeout por pedido y pausa entre casos, en segundos; solo openai)
//   npm run evals -- --retries 4 --retry-delay 30  ante un 429 por minuto, espera y reintenta en vez de dar error
//
// Usa la misma configuración que el backend (ASSISTANT_PROVIDER, ASSISTANT_MODEL, claves) y guarda el resultado en
// evals/results/<proveedor>__<modelo>__<fecha>.json; `npm run evals:compare` los compara por proveedor.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { loadConfig } from '../src/infrastructure/config.js';
import { createLlmClient } from '../src/infrastructure/integrations/llm/index.js';
import { runEvals } from './runEval.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

// JWT_SECRET no se usa acá, pero loadConfig lo exige.
const config = loadConfig({ JWT_SECRET: 'evals', ...process.env });
const timeout = Number(arg('timeout') ?? 0);
const llm = createLlmClient(config, { timeoutMs: timeout * 1000 });
if (!llm) {
  console.error('[evals] falta la clave del proveedor elegido (ANTHROPIC_API_KEY, o ASSISTANT_PROVIDER=openai con ASSISTANT_BASE_URL).');
  process.exit(1);
}

const repeat = Number(arg('repeat') ?? 1);
const only = arg('only')?.split(',');
const pauseMs = Number(arg('pause') ?? 0) * 1000;
const retries = Number(arg('retries') ?? 0);
const retryDelayMs = Number(arg('retry-delay') ?? 30) * 1000;
console.log(`[evals] ${config.assistantProvider} / ${config.assistantModel} — repeticiones: ${repeat}`);

const results = await runEvals(llm, {
  only,
  repeat,
  pauseMs,
  retries,
  retryDelayMs,
  onResult: (r) => console.log(`${r.pass ? 'PASA ' : r.error ? 'ERROR' : 'FALLA'} ${r.id}#${r.run}${r.reason ? ` — ${r.reason}` : ''}${r.error ? ` — ${r.error}` : ''}`),
});

const passed = results.filter((r) => r.pass).length;
const usage = results.reduce((acc, r) => ({
  requests: acc.requests + r.usage.requests, input_tokens: acc.input_tokens + r.usage.input_tokens, output_tokens: acc.output_tokens + r.usage.output_tokens,
}), { requests: 0, input_tokens: 0, output_tokens: 0 });
console.log(`[evals] ${passed}/${results.length} aprobados · ${usage.requests} pedidos · ${usage.input_tokens} tokens de entrada · ${usage.output_tokens} de salida`);

const dir = new URL('./results/', import.meta.url);
mkdirSync(dir, { recursive: true });
const safe = (s) => s.replace(/[^A-Za-z0-9._-]/g, '_');
const file = new URL(`${safe(config.assistantProvider)}__${safe(config.assistantModel)}__${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir);
writeFileSync(file, JSON.stringify({ provider: config.assistantProvider, model: config.assistantModel, date: new Date().toISOString(), repeat, usage, results }, null, 2));
console.log(`[evals] resultado: ${file.pathname}`);
process.exit(passed === results.length ? 0 : 1);
