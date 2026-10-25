// spec 011 RNF-3 — LLM falso que implementa el puerto llmClient: responde un guion fijo y registra cada pedido.
// `npm test` nunca llama a un proveedor real.

// Respuestas cortas para armar guiones.
export const text = (t, stopReason = 'end_turn') => ({ content: [{ type: 'text', text: t }], stopReason });
export const toolUse = (...calls) => ({
  content: calls.map(([name, input, id]) => ({ type: 'tool_use', id: id ?? `tu_${name}_${Math.random().toString(16).slice(2, 8)}`, name, input })),
  stopReason: 'tool_use',
});

// `script`: lista de respuestas, o funciones (request, i) → respuesta, o Error a lanzar.
export const createFakeLlm = (script = []) => {
  const requests = [];
  return {
    requests,
    send: async (request) => {
      // Copia profunda: el bucle sigue agregando mensajes al mismo arreglo.
      const snapshot = structuredClone(request);
      requests.push(snapshot);
      const step = script[requests.length - 1];
      if (step === undefined) throw new Error(`fakeLlm: sin respuesta para el pedido ${requests.length}`);
      if (step instanceof Error) throw step;
      const response = typeof step === 'function' ? step(snapshot, requests.length - 1) : step;
      return { usage: { input_tokens: 10, output_tokens: 5 }, ...structuredClone(response) };
    },
  };
};
