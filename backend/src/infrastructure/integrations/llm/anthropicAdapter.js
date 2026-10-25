import { LlmUnavailableError } from './port.js';

// spec 011 T6c — adaptador del puerto llmClient para la Messages API de Anthropic. Es el único módulo que conoce
// el SDK, y lo importa de forma dinámica: con ASSISTANT_PROVIDER=openai nunca se carga.
// Las opciones propias de Anthropic viven solo acá: thinking adaptativo, effort explícito, tools con strict y
// cache_control sobre el prefijo estable (tools + system) y sobre el historial.

const PROVIDER = 'anthropic';
const EFFORT = 'medium'; // uso de herramientas en varios pasos; el default del modelo varía, por eso se fija
const MAX_TOKENS = 8000; // el thinking cuenta dentro de max_tokens
const TIMEOUT_MS = 60_000;
const EPHEMERAL = { type: 'ephemeral' };

const STOP_REASONS = {
  end_turn: 'end_turn',
  stop_sequence: 'end_turn',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'max_tokens',
  refusal: 'refusal',
};

const toBlock = (block) => {
  switch (block.type) {
    case 'text': return { type: 'text', text: block.text };
    case 'tool_use': return { type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} };
    case 'tool_result': return {
      type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content, ...(block.is_error ? { is_error: true } : {}),
    };
    // Bloques de Anthropic (thinking, redacted_thinking) vuelven intactos: el historial es solo-append.
    case 'opaque': return block.provider === PROVIDER ? block.data : null;
    default: return null;
  }
};

export const toAnthropicMessages = (messages) =>
  messages.map(({ role, content }) => ({
    role,
    content: typeof content === 'string' ? content : content.map(toBlock).filter(Boolean),
  }));

export const toAnthropicRequest = ({ model, system, messages, tools }) => ({
  model,
  max_tokens: MAX_TOKENS,
  thinking: { type: 'adaptive' },
  output_config: { effort: EFFORT },
  // Cachea el historial que crece entre iteraciones del bucle y entre mensajes.
  cache_control: EPHEMERAL,
  system: system.map(({ text, cache }) => ({ type: 'text', text, ...(cache ? { cache_control: EPHEMERAL } : {}) })),
  tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema, strict: true })),
  messages: toAnthropicMessages(messages),
});

export const fromAnthropicResponse = (response) => ({
  content: (response.content ?? []).map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    return { type: 'opaque', provider: PROVIDER, data: block };
  }),
  stopReason: STOP_REASONS[response.stop_reason] ?? 'end_turn',
  usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 },
});

// RF-18: límite de uso, red, timeout y 5xx (incluido 529 overloaded) → assistant_busy; credenciales → unavailable.
export const translateError = (err, sdk) => {
  if (err instanceof sdk.RateLimitError || err instanceof sdk.APIConnectionError || err instanceof sdk.InternalServerError) {
    return new LlmUnavailableError('assistant_busy', { cause: err });
  }
  if (err instanceof sdk.AuthenticationError || err instanceof sdk.PermissionDeniedError) {
    return new LlmUnavailableError('assistant_unavailable', { cause: err });
  }
  if (err instanceof sdk.APIError && Number.isInteger(err.status) && err.status >= 500) {
    return new LlmUnavailableError('assistant_busy', { cause: err });
  }
  return err;
};

export const createAnthropicAdapter = ({ apiKey, model, loadSdk = () => import('@anthropic-ai/sdk') }) => {
  let ready;
  const init = () => (ready ??= loadSdk().then((sdk) => ({
    sdk,
    client: new sdk.default({ apiKey, timeout: TIMEOUT_MS, maxRetries: 2 }),
  })));

  return {
    send: async ({ system, messages, tools }) => {
      const { sdk, client } = await init();
      let response;
      try {
        response = await client.messages.create(toAnthropicRequest({ model, system, messages, tools }));
      } catch (err) {
        throw translateError(err, sdk);
      }
      return fromAnthropicResponse(response);
    },
  };
};
