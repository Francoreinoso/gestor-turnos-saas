// spec 011 T7 — bucle del agente sobre el puerto llmClient, con un LLM falso (RF-10, RF-16, RF-18, RNF-3, RNF-4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { runAssistantTurn, GENERIC_REPLIES } from '../../src/application/assistant/runAssistantTurn.js';
import { rule } from '../../src/domain/validation.js';
import { createFakeLlm, text, toolUse } from '../helpers/fakeLlm.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const STARTED = new Date(2026, 9, 24, 9, 0);

const fakeTool = (name, run = async () => ({ ok: true })) => ({
  name, description: `Herramienta ${name} de prueba`,
  input_schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'], additionalProperties: false },
  schema: z.strictObject({ n: z.number({ error: rule('invalid_input') }) }, { error: rule('invalid_input') }),
  run,
});

const makeRepos = () => {
  const discarded = [];
  return { discarded, assistantProposals: { markStatus: async (db, id, status) => { discarded.push([id, status]); } } };
};

const turn = (llm, extra = {}) => runAssistantTurn({
  llm, db: {}, repos: makeRepos(), accountId: ACCOUNT, clientId: CLIENT, businessName: 'Barbería', startedAt: STARTED,
  messages: [], userMessage: 'hola', tools: [fakeTool('uno'), fakeTool('dos')], ...extra,
});

test('respuesta directa: historial = mensaje del cliente + respuesta; prompt con negocio y fecha', async () => {
  const llm = createFakeLlm([text('¡Hola! ¿Qué servicio buscas?')]);
  const res = await turn(llm);

  assert.equal(res.outcome, 'ok');
  assert.equal(res.reply, '¡Hola! ¿Qué servicio buscas?');
  assert.deepEqual(res.messages, [
    { role: 'user', content: [{ type: 'text', text: 'hola' }] },
    { role: 'assistant', content: [{ type: 'text', text: '¡Hola! ¿Qué servicio buscas?' }] },
  ]);
  const { system, tools } = llm.requests[0];
  assert.equal(system[0].cache, true);
  assert.match(system[1].text, /Barbería/);
  assert.match(system[1].text, /2026-10-24T09:00/);
  assert.deepEqual(tools.map(t => t.name), ['uno', 'dos']);
  assert.equal(tools[0].schema, undefined, 'al modelo solo le llega la definición');
});

test('tool_use paralelo: corren a la vez y todos los resultados van en un único mensaje, en orden', async () => {
  const started = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = (name) => fakeTool(name, async () => { started.push(name); if (started.length === 2) release(); await gate; return { de: name }; });
  const llm = createFakeLlm([toolUse(['uno', { n: 1 }, 'a'], ['dos', { n: 2 }, 'b']), text('Listo')]);

  const res = await turn(llm, { tools: [slow('uno'), slow('dos')] });

  assert.deepEqual(started.sort(), ['dos', 'uno']);
  const resultsMsg = llm.requests[1].messages.at(-1);
  assert.equal(resultsMsg.role, 'user');
  assert.deepEqual(resultsMsg.content, [
    { type: 'tool_result', tool_use_id: 'a', content: '{"de":"uno"}' },
    { type: 'tool_result', tool_use_id: 'b', content: '{"de":"dos"}' },
  ]);
  assert.equal(res.reply, 'Listo');
  assert.equal(res.messages.length, 4);
});

test('la identidad llega a las herramientas desde la sesión, nunca desde el modelo', async () => {
  let seen;
  const llm = createFakeLlm([toolUse(['uno', { n: 1 }]), text('ok')]);
  await turn(llm, { tools: [fakeTool('uno', async (ctx) => { seen = { accountId: ctx.accountId, clientId: ctx.clientId }; return {}; })] });
  assert.deepEqual(seen, { accountId: ACCOUNT, clientId: CLIENT });
});

test('entrada inválida → el modelo recibe is_error y puede corregir — RF-10', async () => {
  let runs = 0;
  const llm = createFakeLlm([toolUse(['uno', { n: 'uno' }, 'x']), toolUse(['uno', { n: 1 }, 'y']), text('ok')]);
  await turn(llm, { tools: [fakeTool('uno', async () => { runs++; return {}; })] });

  const first = llm.requests[1].messages.at(-1).content[0];
  assert.equal(first.is_error, true);
  assert.equal(JSON.parse(first.content).error, 'invalid_input');
  assert.equal(runs, 1, 'solo corrió la llamada válida');
});

test('historial solo-append: cada pedido extiende al anterior y conserva los bloques opacos', async () => {
  const opaque = { type: 'opaque', provider: 'anthropic', data: { type: 'thinking', thinking: '', signature: 'sig' } };
  const llm = createFakeLlm([
    { content: [opaque, { type: 'tool_use', id: 't1', name: 'uno', input: { n: 1 } }], stopReason: 'tool_use' },
    toolUse(['dos', { n: 2 }, 't2']),
    text('fin'),
  ]);
  const previous = [{ role: 'user', content: [{ type: 'text', text: 'antes' }] }, { role: 'assistant', content: [{ type: 'text', text: 'hola' }] }];
  const res = await turn(llm, { messages: previous });

  for (let i = 1; i < llm.requests.length; i++) {
    const prev = llm.requests[i - 1];
    const cur = llm.requests[i];
    assert.deepEqual(cur.system, prev.system, 'system idéntico');
    assert.deepEqual(cur.tools, prev.tools, 'tools idénticas');
    assert.deepEqual(cur.messages.slice(0, prev.messages.length), prev.messages, 'prefijo intacto');
  }
  assert.deepEqual(llm.requests[0].messages.slice(0, 2), previous);
  assert.deepEqual(res.messages[3].content[0], opaque);
});

test('tope de 8 iteraciones por mensaje → mensaje genérico; lo ejecutado queda en el historial — RF-16', async () => {
  const llm = createFakeLlm(Array.from({ length: 20 }, (_, i) => toolUse(['uno', { n: i }, `t${i}`])));
  const res = await turn(llm);

  assert.equal(llm.requests.length, 8);
  assert.equal(res.outcome, 'iteration_limit');
  assert.equal(res.reply, GENERIC_REPLIES.iteration_limit);
  assert.equal(res.messages.at(-1).content[0].type, 'tool_result');
});

test('refusal sin herramientas ejecutadas → mensaje genérico y el historial queda como estaba — RF-16', async () => {
  const previous = [{ role: 'user', content: [{ type: 'text', text: 'antes' }] }, { role: 'assistant', content: [{ type: 'text', text: 'hola' }] }];
  const llm = createFakeLlm([{ content: [{ type: 'text', text: 'parcial' }], stopReason: 'refusal' }]);
  const res = await turn(llm, { messages: previous });

  assert.equal(res.outcome, 'refusal');
  assert.equal(res.reply, GENERIC_REPLIES.refusal);
  assert.deepEqual(res.messages, previous);
  assert.doesNotMatch(res.reply, /parcial/);
});

test('max_tokens tras ejecutar herramientas → descarta solo la respuesta truncada — RF-16', async () => {
  const llm = createFakeLlm([toolUse(['uno', { n: 1 }, 't1']), { content: [{ type: 'text', text: 'trunc' }], stopReason: 'max_tokens' }]);
  const res = await turn(llm);

  assert.equal(res.outcome, 'max_tokens');
  assert.equal(res.reply, GENERIC_REPLIES.max_tokens);
  assert.equal(res.messages.length, 3);
  assert.equal(res.messages.at(-1).content[0].type, 'tool_result');
});

test('si el proveedor falla a mitad del mensaje, las propuestas del mensaje se descartan y el error se propaga — RF-18', async () => {
  const busy = Object.assign(new Error('assistant_busy'), { code: 'assistant_busy' });
  const proposing = fakeTool('uno', async (ctx) => { ctx.proposals.push({ id: 'p1' }); return {}; });
  const llm = createFakeLlm([toolUse(['uno', { n: 1 }]), busy]);
  const repos = makeRepos();

  await assert.rejects(() => turn(llm, { repos, tools: [proposing] }), /assistant_busy/);
  assert.deepEqual(repos.discarded, [['p1', 'descartada']]);
});

test('respuesta sin texto → mensaje de cortesía', async () => {
  const res = await turn(createFakeLlm([{ content: [], stopReason: 'end_turn' }]));
  assert.equal(res.reply, GENERIC_REPLIES.empty);
});
