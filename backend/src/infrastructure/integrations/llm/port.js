// spec 011 RNF-4 — puerto llmClient: el bucle del agente habla solo este formato; cada adaptador traduce desde y
// hacia el de su proveedor.
//
//   llm.send({ system, messages, tools }) → Promise<{ content, stopReason, usage }>
//
// system:   [{ text, cache? }]  — bloques del prompt de sistema; `cache` marca el prefijo estable.
// tools:    [{ name, description, input_schema }]  — JSON Schema estricto (additionalProperties: false).
// messages: [{ role: 'user' | 'assistant', content: string | Block[] }]
// Block:
//   { type: 'text', text }
//   { type: 'tool_use', id, name, input, invalid_json?, raw_arguments?, provider_fields? }
//       invalid_json: el proveedor devolvió argumentos que no son un objeto JSON (se responde con is_error).
//       provider_fields: campos propios del proveedor en la llamada (p. ej. firmas de razonamiento) que el mismo
//       adaptador devuelve intactos.
//   { type: 'tool_result', tool_use_id, content: string, is_error? }
//   { type: 'opaque', provider, data }
//       bloque propio de un proveedor (p. ej. thinking de Anthropic) que debe volver intacto en el historial;
//       los demás adaptadores lo ignoran.
// stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal'
// usage:      { input_tokens, output_tokens }
//
// Errores: un adaptador lanza LlmUnavailableError ante límite de uso (429), error de red, timeout o 5xx
// ('assistant_busy', RF-18), o ante credenciales rechazadas ('assistant_unavailable', RNF-2). El detalle del
// proveedor nunca viaja en el mensaje.

export const STOP_REASONS = ['end_turn', 'tool_use', 'max_tokens', 'refusal'];

export class LlmUnavailableError extends Error {
  constructor(code = 'assistant_busy', { cause } = {}) {
    super(code);
    this.name = 'LlmUnavailableError';
    this.code = code;
    // La causa queda para el log del servidor, nunca para la respuesta.
    if (cause) this.cause = cause;
  }
}
