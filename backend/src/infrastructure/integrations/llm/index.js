import { createAnthropicAdapter } from './anthropicAdapter.js';
import { createOpenAiAdapter } from './openaiAdapter.js';

// spec 011 — elige el adaptador según ASSISTANT_PROVIDER. Devuelve null si el proveedor elegido no tiene lo que
// necesita (RNF-2): /assistant/* responde 503 assistant_unavailable y el resto de la app funciona igual.
// `timeoutMs` solo lo ajustan los evals (capas gratuitas lentas); el backend usa el de cada adaptador.
export const createLlmClient = (config, { timeoutMs } = {}) => {
  if (config.assistantProvider === 'openai') {
    // loadConfig ya exige base URL y modelo con openai; la clave es opcional (Ollama local no la pide).
    return createOpenAiAdapter({ baseUrl: config.assistantBaseUrl, apiKey: config.assistantApiKey, model: config.assistantModel, ...(timeoutMs ? { timeoutMs } : {}) });
  }
  if (!config.anthropicApiKey) return null;
  return createAnthropicAdapter({ apiKey: config.anthropicApiKey, model: config.assistantModel });
};
