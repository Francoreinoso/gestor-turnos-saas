import { MAX_TOOL_ITERATIONS } from '../../domain/assistant.js';
import { executeToolCall, toolDefinitions, TOOLS } from './tools/index.js';
import { buildSystemPrompt } from './systemPrompt.js';

// RF-16: los cortes anormales se informan con un mensaje genérico, sin detalles del proveedor.
export const GENERIC_REPLIES = {
  refusal: 'No puedo ayudarte con eso. Puedo ayudarte con los turnos del negocio: ver servicios, horarios, reservar o cancelar.',
  max_tokens: 'No pude completar la respuesta. ¿Puedes reformular tu pedido en pocas palabras?',
  iteration_limit: 'No pude completar tu pedido en este paso. ¿Puedes contarme de nuevo, en pocas palabras, qué necesitas?',
  empty: '¿En qué más te puedo ayudar con tus turnos?',
};

const textOf = (content) => content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

// spec 011 RF-10, RF-16 — un mensaje del cliente: bucle manual sobre el puerto llmClient, sin formato de ningún
// proveedor. Historial solo-append; todos los tool_result de una respuesta van juntos en un único mensaje de
// usuario; las herramientas de una misma respuesta corren en paralelo; máximo 8 iteraciones.
// La identidad (accountId, clientId) sale de la sesión y llega a las herramientas por el contexto.
// Devuelve el historial nuevo, la respuesta para el cliente y las propuestas creadas en este mensaje.
export const runAssistantTurn = async ({
  llm, db, repos, accountId, clientId, businessName, startedAt, messages, userMessage, now = new Date(), tools = TOOLS,
}) => {
  const system = buildSystemPrompt({ businessName, startedAt });
  const definitions = toolDefinitions(tools);
  const history = [...messages, { role: 'user', content: [{ type: 'text', text: userMessage }] }];
  const turnStart = messages.length;
  const proposals = [];
  const ctx = { db, repos, accountId, clientId, now, messages: history, proposals };

  // Una respuesta anómala se descarta (puede ser parcial). Si el mensaje no llegó a ejecutar herramientas, también se
  // descarta el mensaje del cliente: así no queda en el historial algo que el modelo vuelva a rechazar.
  const abort = (outcome) => {
    const kept = history.length - turnStart === 1 ? messages : history;
    return { messages: kept, reply: GENERIC_REPLIES[outcome], proposals, outcome };
  };

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await llm.send({ system, messages: history, tools: definitions });
      if (response.stopReason === 'refusal' || response.stopReason === 'max_tokens') return abort(response.stopReason);

      history.push({ role: 'assistant', content: response.content });
      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      if (response.stopReason !== 'tool_use' || toolUses.length === 0) {
        return { messages: history, reply: textOf(response.content) || GENERIC_REPLIES.empty, proposals, outcome: 'ok' };
      }

      const results = await Promise.all(toolUses.map((toolUse) => executeToolCall(toolUse, ctx, tools)));
      history.push({ role: 'user', content: results });
    }
  } catch (err) {
    // RF-18: si el proveedor (o algo inesperado) corta el mensaje a mitad, ninguna propuesta queda pendiente sin que
    // el cliente haya visto su botón.
    await Promise.all(proposals.map((p) => repos.assistantProposals.markStatus(db, p.id, 'descartada')));
    throw err;
  }

  // Tope alcanzado: el historial termina en los tool_result (lo ya ejecutado queda registrado).
  return { messages: history, reply: GENERIC_REPLIES.iteration_limit, proposals, outcome: 'iteration_limit' };
};
