// spec 011 T6b–T6d — puerto llmClient y sus adaptadores, con SDK y fetch simulados (RNF-3: nunca la API real).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as realSdk from '@anthropic-ai/sdk';
import { STOP_REASONS, LlmUnavailableError } from '../../src/infrastructure/integrations/llm/port.js';
import { createAnthropicAdapter, translateError } from '../../src/infrastructure/integrations/llm/anthropicAdapter.js';
import { createOpenAiAdapter } from '../../src/infrastructure/integrations/llm/openaiAdapter.js';
import { createLlmClient } from '../../src/infrastructure/integrations/llm/index.js';
import { createFakeLlm, text } from '../helpers/fakeLlm.js';

const SYSTEM = [{ text: 'Eres el asistente.', cache: true }, { text: 'Fecha: 2026-10-24' }];
const TOOLS = [{ name: 'listar_servicios', description: 'Lista', input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false } }];
const THINKING = { type: 'thinking', thinking: '', signature: 'firma-opaca' };
const MESSAGES = [
  { role: 'user', content: 'hola' },
  { role: 'assistant', content: [
    { type: 'opaque', provider: 'anthropic', data: THINKING },
    { type: 'opaque', provider: 'otro', data: { type: 'raro' } },
    { type: 'text', text: 'Busco.' },
    { type: 'tool_use', id: 'tu_1', name: 'listar_servicios', input: {} },
  ] },
  { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'tu_1', content: '{"error":"x"}', is_error: true },
    { type: 'text', text: 'y el precio?' },
  ] },
];

// Contrato del puerto: lo cumple cualquier implementación (adaptadores reales y el LLM falso).
const assertNormalized = (res) => {
  assert.ok(Array.isArray(res.content));
  for (const b of res.content) assert.ok(['text', 'tool_use', 'opaque'].includes(b.type), b.type);
  assert.ok(STOP_REASONS.includes(res.stopReason), res.stopReason);
  assert.equal(typeof res.usage.input_tokens, 'number');
  assert.equal(typeof res.usage.output_tokens, 'number');
};

// ── Anthropic ─────────────────────────────────────────────────────────────────

class FakeApiError extends Error { constructor(status) { super(`status ${status}`); this.status = status; } }
const fakeSdk = (respond) => {
  const sdk = {
    calls: [], constructed: [],
    APIError: FakeApiError,
    RateLimitError: class extends FakeApiError {}, APIConnectionError: class extends FakeApiError {},
    InternalServerError: class extends FakeApiError {}, AuthenticationError: class extends FakeApiError {},
    PermissionDeniedError: class extends FakeApiError {}, BadRequestError: class extends FakeApiError {},
  };
  sdk.default = class {
    constructor(opts) { sdk.constructed.push(opts); }
    messages = { create: async (req) => { sdk.calls.push(req); return respond(req, sdk); } };
  };
  return sdk;
};

const anthropicResponse = (overrides = {}) => ({
  content: [THINKING, { type: 'text', text: 'Hola' }, { type: 'tool_use', id: 'tu_2', name: 'listar_servicios', input: {} }],
  stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 }, ...overrides,
});

test('anthropic: el SDK se importa solo al primer envío y una sola vez', async () => {
  let loads = 0;
  const sdk = fakeSdk(() => anthropicResponse());
  const llm = createAnthropicAdapter({ apiKey: 'k', model: 'claude-sonnet-5-5', loadSdk: async () => { loads++; return sdk; } });
  assert.equal(loads, 0);
  await llm.send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
  await llm.send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
  assert.equal(loads, 1);
  assert.equal(sdk.constructed[0].apiKey, 'k');
});

test('anthropic: opciones propias (thinking adaptativo, effort, strict, caché) y bloques opacos intactos', async () => {
  const sdk = fakeSdk(() => anthropicResponse());
  const llm = createAnthropicAdapter({ apiKey: 'k', model: 'claude-sonnet-5-5', loadSdk: async () => sdk });
  await llm.send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
  const req = sdk.calls[0];

  assert.equal(req.model, 'claude-sonnet-5-5');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.equal(req.output_config.effort, 'medium');
  assert.equal(req.tool_choice, undefined, 'sin tool_choice forzado');
  assert.equal(req.tools[0].strict, true);
  assert.deepEqual(req.system[0].cache_control, { type: 'ephemeral' }, 'prefijo estable cacheado');
  assert.equal(req.system[1].cache_control, undefined, 'la parte variable no lleva marca');
  assert.deepEqual(req.messages[1].content[0], THINKING, 'thinking vuelve igual');
  assert.equal(req.messages[1].content.length, 3, 'el bloque opaco de otro proveedor se descarta');
  assert.deepEqual(req.messages[2].content[0], { type: 'tool_result', tool_use_id: 'tu_1', content: '{"error":"x"}', is_error: true });
  assert.equal(req.messages[0].content, 'hola');
});

test('anthropic: respuesta normalizada; thinking como bloque opaco y stop_reason traducido', async () => {
  const cases = [['tool_use', 'tool_use'], ['end_turn', 'end_turn'], ['max_tokens', 'max_tokens'], ['refusal', 'refusal'],
    ['model_context_window_exceeded', 'max_tokens'], ['stop_sequence', 'end_turn']];
  for (const [raw, expected] of cases) {
    const sdk = fakeSdk(() => anthropicResponse({ stop_reason: raw }));
    const res = await createAnthropicAdapter({ apiKey: 'k', model: 'm', loadSdk: async () => sdk }).send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
    assertNormalized(res);
    assert.equal(res.stopReason, expected, raw);
    assert.deepEqual(res.content[0], { type: 'opaque', provider: 'anthropic', data: THINKING });
    assert.deepEqual(res.content[2], { type: 'tool_use', id: 'tu_2', name: 'listar_servicios', input: {} });
    assert.deepEqual(res.usage, { input_tokens: 100, output_tokens: 20 });
  }
});

test('anthropic: 429, red, timeout y 5xx → assistant_busy; credenciales → assistant_unavailable; el resto se propaga — RF-18', async () => {
  const run = async (makeErr) => {
    const sdk = fakeSdk((req, s) => { throw makeErr(s); });
    return createAnthropicAdapter({ apiKey: 'k', model: 'm', loadSdk: async () => sdk }).send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
  };
  for (const make of [(s) => new s.RateLimitError(429), (s) => new s.APIConnectionError(), (s) => new s.InternalServerError(529), (s) => new s.APIError(503)]) {
    await assert.rejects(() => run(make), (err) => err instanceof LlmUnavailableError && err.code === 'assistant_busy');
  }
  for (const make of [(s) => new s.AuthenticationError(401), (s) => new s.PermissionDeniedError(403)]) {
    await assert.rejects(() => run(make), (err) => err instanceof LlmUnavailableError && err.code === 'assistant_unavailable');
  }
  await assert.rejects(() => run((s) => new s.BadRequestError(400)), (err) => !(err instanceof LlmUnavailableError));
});

test('anthropic: translateError reconoce las clases reales del SDK instalado', () => {
  const headers = new Headers();
  assert.equal(translateError(new realSdk.RateLimitError(429, {}, 'x', headers), realSdk).code, 'assistant_busy');
  assert.equal(translateError(new realSdk.InternalServerError(529, {}, 'x', headers), realSdk).code, 'assistant_busy');
  assert.equal(translateError(new realSdk.APIConnectionTimeoutError(), realSdk).code, 'assistant_busy');
  assert.equal(translateError(new realSdk.AuthenticationError(401, {}, 'x', headers), realSdk).code, 'assistant_unavailable');
  const bad = new realSdk.BadRequestError(400, {}, 'x', headers);
  assert.equal(translateError(bad, realSdk), bad);
});

// ── OpenAI compatible ─────────────────────────────────────────────────────────

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const completion = (message, finish_reason = 'stop') => ({
  choices: [{ message: { role: 'assistant', content: null, ...message }, finish_reason }],
  usage: { prompt_tokens: 50, completion_tokens: 7 },
});
const openai = (respond, { apiKey = 'clave-secreta' } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return respond(url, init); };
  return { calls, llm: createOpenAiAdapter({ baseUrl: 'http://llm.test/v1/', apiKey, model: 'gemma', fetchImpl }) };
};

test('openai: traduce el historial a chat/completions (system, tool_calls, role tool) y descarta lo opaco', async () => {
  const { calls, llm } = openai(() => jsonResponse(completion({ content: 'Listo' })));
  await llm.send({ system: SYSTEM, messages: [...MESSAGES, { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_9', name: 'x', input: null, invalid_json: true, raw_arguments: '{mal' }] }], tools: TOOLS });
  const { url, init, body } = calls[0];

  assert.equal(url, 'http://llm.test/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer clave-secreta');
  assert.equal(body.model, 'gemma');
  assert.deepEqual(body.messages[0], { role: 'system', content: 'Eres el asistente.\n\nFecha: 2026-10-24' });
  assert.deepEqual(body.messages[1], { role: 'user', content: 'hola' });
  assert.deepEqual(body.messages[2], {
    role: 'assistant', content: 'Busco.',
    tool_calls: [{ id: 'tu_1', type: 'function', function: { name: 'listar_servicios', arguments: '{}' } }],
  });
  assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: 'tu_1', content: '{"error":"x"}' });
  assert.deepEqual(body.messages[4], { role: 'user', content: 'y el precio?' });
  assert.equal(body.messages[5].tool_calls[0].function.arguments, '{mal', 'los argumentos inválidos vuelven como los escribió');
  assert.deepEqual(body.tools[0], { type: 'function', function: { name: 'listar_servicios', description: 'Lista', parameters: TOOLS[0].input_schema } });
  assert.doesNotMatch(init.body, /firma-opaca|raro/);
});

test('openai: sin clave no manda Authorization (Ollama local)', async () => {
  const { calls, llm } = openai(() => jsonResponse(completion({ content: 'ok' })), { apiKey: null });
  await llm.send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test('openai: tool_calls → tool_use y finish_reason → stopReason', async () => {
  const toolCall = (args, id = 'call_1') => ({ id, type: 'function', function: { name: 'listar_servicios', arguments: args } });
  const cases = [
    [completion({ tool_calls: [toolCall('{}')] }, 'tool_calls'), 'tool_use'],
    [completion({ tool_calls: [toolCall('{}')] }, 'stop'), 'tool_use'],
    [completion({ content: 'hola' }, 'stop'), 'end_turn'],
    [completion({ content: 'hol' }, 'length'), 'max_tokens'],
    [completion({ content: '' }, 'content_filter'), 'refusal'],
  ];
  for (const [response, expected] of cases) {
    const res = await openai(() => jsonResponse(response)).llm.send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
    assertNormalized(res);
    assert.equal(res.stopReason, expected);
    assert.deepEqual(res.usage, { input_tokens: 50, output_tokens: 7 });
  }

  const res = await openai(() => jsonResponse(completion({ content: 'Veo', tool_calls: [toolCall('{"a":1}'), toolCall('{}', '')] }, 'tool_calls')))
    .llm.send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
  assert.deepEqual(res.content[0], { type: 'text', text: 'Veo' });
  assert.deepEqual(res.content[1], { type: 'tool_use', id: 'call_1', name: 'listar_servicios', input: { a: 1 } });
  assert.match(res.content[2].id, /^call_[0-9a-f]+$/, 'id generado si el proveedor no lo manda');
});

test('openai: argumentos con JSON inválido → tool_use con invalid_json, no un error del servidor', async () => {
  for (const args of ['{"servicio_id": ', '[1,2]', '"texto"', 'null']) {
    const res = await openai(() => jsonResponse(completion({ tool_calls: [{ id: 'c', type: 'function', function: { name: 'listar_servicios', arguments: args } }] }, 'tool_calls')))
      .llm.send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
    assert.equal(res.stopReason, 'tool_use');
    assert.deepEqual(res.content[0], { type: 'tool_use', id: 'c', name: 'listar_servicios', input: null, invalid_json: true, raw_arguments: args }, args);
  }
});

test('openai: 429, 5xx, red, timeout o cuerpo ilegible → assistant_busy; 401/403 → unavailable; sin filtrar detalles — RF-18', async () => {
  const send = (respond) => openai(respond).llm.send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
  const busy = [
    () => jsonResponse({ error: { message: 'rate limited, key clave-secreta' } }, 429),
    () => jsonResponse({ error: 'boom' }, 500),
    () => jsonResponse({ error: 'overloaded' }, 503),
    () => { throw new TypeError('fetch failed'); },
    () => { throw new DOMException('The operation timed out.', 'TimeoutError'); },
    () => new Response('<html>no es json</html>', { status: 200 }),
    () => jsonResponse({ choices: [] }),
  ];
  for (const respond of busy) {
    await assert.rejects(() => send(respond), (err) => {
      assert.ok(err instanceof LlmUnavailableError, String(err));
      assert.equal(err.message, 'assistant_busy');
      return true;
    });
  }
  for (const status of [401, 403]) {
    await assert.rejects(() => send(() => jsonResponse({ error: 'bad key' }, status)), (err) => err instanceof LlmUnavailableError && err.code === 'assistant_unavailable');
  }
  await assert.rejects(() => send(() => jsonResponse({ error: { message: 'detalle del proveedor' } }, 400)), (err) => {
    assert.ok(!(err instanceof LlmUnavailableError));
    assert.doesNotMatch(err.message, /detalle del proveedor|clave-secreta/);
    return true;
  });
});

test('openai: un servidor que no responde se corta por timeout → assistant_busy', async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const llm = createOpenAiAdapter({ baseUrl: 'http://llm.test', model: 'm', fetchImpl, timeoutMs: 20 });
  await assert.rejects(() => llm.send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS }), (err) => err.code === 'assistant_busy');
});

// ── Puerto y selección ───────────────────────────────────────────────────────

test('el LLM falso cumple el contrato y registra copias de cada pedido', async () => {
  const llm = createFakeLlm([text('hola')]);
  const messages = [{ role: 'user', content: 'x' }];
  const res = await llm.send({ system: SYSTEM, messages, tools: TOOLS });
  messages.push({ role: 'assistant', content: 'mutado' });
  assertNormalized(res);
  assert.equal(llm.requests[0].messages.length, 1, 'copia, no referencia');
});

test('createLlmClient: elige adaptador según el proveedor; anthropic sin clave → null (RNF-2)', () => {
  assert.equal(createLlmClient({ assistantProvider: 'anthropic', anthropicApiKey: null, assistantModel: 'm' }), null);
  assert.equal(typeof createLlmClient({ assistantProvider: 'anthropic', anthropicApiKey: 'k', assistantModel: 'm' }).send, 'function');
  assert.equal(typeof createLlmClient({ assistantProvider: 'openai', assistantBaseUrl: 'http://localhost:11434/v1', assistantApiKey: null, assistantModel: 'm' }).send, 'function');
});

test('openai: la firma de Gemini 3 (extra_content, en el mensaje y en cada tool_call) vuelve intacta; otros campos no', async () => {
  const sig = (v) => ({ google: { thought_signature: v } });
  const call = { id: 'c1', type: 'function', function: { name: 'listar_servicios', arguments: '{}' }, extra_content: sig('firma-call') };
  const { calls, llm } = openai(() => jsonResponse(completion({ content: 'Busco', tool_calls: [call], extra_content: sig('firma-msg'), reasoning: 'texto interno' }, 'tool_calls')));
  const res = await llm.send({ system: SYSTEM, messages: [{ role: 'user', content: 'hola' }], tools: TOOLS });
  assertNormalized(res);
  assert.deepEqual(res.content[1].provider_fields, { extra_content: sig('firma-call') });
  assert.deepEqual(res.content[2], { type: 'opaque', provider: 'openai', data: { extra_content: sig('firma-msg') } });

  await llm.send({ system: SYSTEM, messages: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: res.content }], tools: TOOLS });
  const echoed = calls[1].body.messages[2];
  assert.deepEqual(echoed, { extra_content: sig('firma-msg'), role: 'assistant', content: 'Busco', tool_calls: [call] });
  assert.equal(echoed.reasoning, undefined, 'solo se reenvía extra_content');

  const plain = await openai(() => jsonResponse(completion({ tool_calls: [{ id: 'c2', type: 'function', function: { name: 'x', arguments: '{}' } }] }, 'tool_calls')))
    .llm.send({ system: SYSTEM, messages: MESSAGES, tools: TOOLS });
  assert.equal(plain.content[0].provider_fields, undefined);
  assert.equal(plain.content.length, 1, 'sin extra_content no hay bloque opaco');
});
