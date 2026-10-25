import { parseInput } from '../../../domain/validation.js';
import { listarServicios } from './listarServicios.js';
import { verDisponibilidad } from './verDisponibilidad.js';
import { verMisTurnos } from './verMisTurnos.js';
import { proponerReserva } from './proponerReserva.js';
import { cancelarTurno } from './cancelarTurno.js';

// Orden fijo: la lista de herramientas forma parte del prefijo que el proveedor cachea.
export const TOOLS = [listarServicios, verDisponibilidad, verMisTurnos, proponerReserva, cancelarTurno];

// Definición que ve el modelo, en el formato normalizado del puerto llmClient.
export const toolDefinitions = (tools = TOOLS) =>
  tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

// Pistas para que el modelo corrija el pedido; nunca incluyen datos internos.
const HINTS = {
  invalid_input: 'Parámetros inválidos: revisa el esquema de la herramienta y no agregues campos extra.',
  invalid_json: 'Los argumentos no eran JSON válido.',
  invalid_date: 'Las fechas van en formato YYYY-MM-DD.',
  invalid_range: 'La fecha hasta no puede ser anterior a desde.',
  range_too_long: 'El rango máximo es de 14 días.',
};

const errorResult = (toolUseId, code, extra = {}) => ({
  type: 'tool_result',
  tool_use_id: toolUseId,
  content: JSON.stringify({ error: code, ...(HINTS[code] ? { detalle: HINTS[code] } : {}), ...extra }),
  is_error: true,
});

const isClientError = (err) => Number.isInteger(err?.status) && err.status >= 400 && err.status < 500;

// Un nombre que solo difiere en mayúsculas se acepta si no es ambiguo.
const findTool = (tools, name) =>
  tools.find((t) => t.name === name) ?? tools.find((t) => t.name.toLowerCase() === String(name).toLowerCase());

// spec 011 RF-10 — ejecuta un tool_use: valida con zod antes de ejecutar; una entrada inválida o un error de
// negocio (4xx) vuelve al modelo como tool_result con is_error, sin ejecutar nada más. Un error inesperado se propaga.
// `ctx` trae la identidad de la sesión (accountId, clientId): ninguna herramienta la toma del modelo.
export const executeToolCall = async (toolUse, ctx, tools = TOOLS) => {
  const tool = findTool(tools, toolUse.name);
  if (!tool) return errorResult(toolUse.id, 'unknown_tool', { herramientas: tools.map((t) => t.name) });
  if (toolUse.invalid_json) return errorResult(toolUse.id, 'invalid_json');

  let input;
  try {
    input = parseInput(tool.schema, toolUse.input ?? {});
  } catch (err) {
    if (isClientError(err)) return errorResult(toolUse.id, err.message === 'invalid_body' ? 'invalid_input' : err.message);
    throw err;
  }

  try {
    const result = await tool.run(ctx, input);
    return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) };
  } catch (err) {
    if (isClientError(err)) return errorResult(toolUse.id, err.message);
    throw err;
  }
};
