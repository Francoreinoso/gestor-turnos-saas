import { randomBytes } from 'crypto';
import { LlmUnavailableError } from './port.js';

// spec 011 T6d — adaptador del puerto llmClient para el protocolo `chat/completions` compatible con OpenAI, con
// `fetch` nativo y sin dependencias. Sirve para capas gratuitas (Gemini, Groq, OpenRouter) y para Ollama local.
// Traduce tool_use ↔ tool_calls, tool_result ↔ mensajes role 'tool' y finish_reason ↔ stopReason.

const PROVIDER = 'openai';
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 60_000;

const STOP_REASONS = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  length: 'max_tokens',
  content_filter: 'refusal',
};

const textOf = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const toOpenAiMessages = (system, messages) => {
  const out = [{ role: 'system', content: system.map((s) => s.text).join('\n\n') }];
  for (const { role, content } of messages) {
    if (typeof content === 'string') {
      out.push({ role, content });
      continue;
    }
    if (role === 'assistant') {
      const toolCalls = content.filter((b) => b.type === 'tool_use').map((b) => ({
        ...b.provider_fields,
        id: b.id,
        type: 'function',
        // Si el modelo mandó JSON inválido se le devuelve tal cual lo escribió, para que vea qué corrigió.
        function: { name: b.name, arguments: b.raw_arguments ?? JSON.stringify(b.input ?? {}) },
      }));
      const text = textOf(content);
      // Campos del mensaje que el mismo proveedor devolvió (firma de razonamiento de Gemini 3) vuelven intactos.
      const extras = Object.assign({}, ...content.filter((b) => b.type === 'opaque' && b.provider === PROVIDER).map((b) => b.data));
      out.push({ ...extras, role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    // Los resultados van primero: deben seguir inmediatamente al mensaje con tool_calls.
    for (const b of content.filter((b) => b.type === 'tool_result')) {
      out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
    }
    const text = textOf(content);
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
};

export const toOpenAiRequest = ({ model, system, messages, tools }) => ({
  model,
  max_tokens: MAX_TOKENS,
  messages: toOpenAiMessages(system, messages),
  tools: tools.map(({ name, description, input_schema }) => ({ type: 'function', function: { name, description, parameters: input_schema } })),
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Argumentos que no son un objeto JSON → tool_use con invalid_json: se le responde al modelo con is_error (RF-10),
// no es un fallo del servidor.
// `extra_content` es el campo de extensiones de Google: Gemini 3 pone ahí su firma de razonamiento, en el mensaje y
// en cada tool_call, y hay que devolverla intacta. Solo se reenvía ese campo (otros, como el `reasoning` de Groq u
// Ollama, podrían hacer que el proveedor rechace el pedido); si no viene, no se envía nada extra.
const PASSTHROUGH = 'extra_content';
const passthrough = (obj) => (obj?.[PASSTHROUGH] === undefined ? null : { [PASSTHROUGH]: obj[PASSTHROUGH] });

const toToolUse = (call) => {
  const id = call.id || `call_${randomBytes(6).toString('hex')}`;
  const name = call.function?.name ?? '';
  const raw = call.function?.arguments ?? '';
  const extra = passthrough(call);
  const providerFields = extra ? { provider_fields: extra } : {};
  let input;
  try { input = typeof raw === 'string' ? (raw.trim() === '' ? {} : JSON.parse(raw)) : raw; } catch { input = undefined; }
  if (!isPlainObject(input)) return { type: 'tool_use', id, name, input: null, invalid_json: true, raw_arguments: String(raw), ...providerFields };
  return { type: 'tool_use', id, name, input, ...providerFields };
};

export const fromOpenAiResponse = (body) => {
  const choice = body?.choices?.[0];
  if (!choice?.message) throw new LlmUnavailableError('assistant_busy'); // respuesta sin forma esperada

  const content = [];
  if (typeof choice.message.content === 'string' && choice.message.content.trim()) content.push({ type: 'text', text: choice.message.content });
  for (const call of choice.message.tool_calls ?? []) content.push(toToolUse(call));
  const messageExtra = passthrough(choice.message);
  if (messageExtra) content.push({ type: 'opaque', provider: PROVIDER, data: messageExtra });

  let stopReason = STOP_REASONS[choice.finish_reason] ?? 'end_turn';
  // Algunos proveedores devuelven tool_calls con finish_reason 'stop'.
  if (stopReason === 'end_turn' && content.some((b) => b.type === 'tool_use')) stopReason = 'tool_use';

  return {
    content,
    stopReason,
    usage: { input_tokens: body.usage?.prompt_tokens ?? 0, output_tokens: body.usage?.completion_tokens ?? 0 },
  };
};

export const createOpenAiAdapter = ({ baseUrl, apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS }) => {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    send: async ({ system, messages, tools }) => {
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify(toOpenAiRequest({ model, system, messages, tools })),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new LlmUnavailableError('assistant_busy', { cause: err }); // red o timeout (RF-18)
      }

      if (res.status === 429 || res.status >= 500) throw new LlmUnavailableError('assistant_busy', { cause: new Error(`http ${res.status}`) });
      if (res.status === 401 || res.status === 403) throw new LlmUnavailableError('assistant_unavailable', { cause: new Error(`http ${res.status}`) });
      // Un 4xx distinto es un pedido mal armado de nuestro lado: error interno, sin el cuerpo del proveedor.
      if (!res.ok) throw new Error(`llm_request_failed: http ${res.status}`);

      let body;
      try { body = await res.json(); } catch (err) { throw new LlmUnavailableError('assistant_busy', { cause: err }); }
      return fromOpenAiResponse(body);
    },
  };
};
