// spec 011 — reglas puras del asistente: vencimientos, fechas que ve el modelo y slots emitidos.

const MINUTE_MS = 60 * 1000;

export const PROPOSAL_TTL_MS = 10 * MINUTE_MS; // RF-8
export const CODE_TTL_MS = 10 * MINUTE_MS; // RF-1
export const CODE_MAX_ATTEMPTS = 5; // RF-3 (también CHECK en la migración 0007)
export const SESSION_TTL_SECONDS = 60 * 60; // RF-2
export const MAX_TOOL_ITERATIONS = 8; // RF-16

export const AVAILABILITY_TOOL = 'ver_disponibilidad';

export const proposalExpiresAt = (now) => new Date(now.getTime() + PROPOSAL_TTL_MS);
export const isExpired = (record, now) => record.expires_at.getTime() <= now.getTime();

const pad = (n) => String(n).padStart(2, '0');

// Fecha en hora local del servidor con su desfase ('2026-10-25T10:00:00-03:00'): legible para el modelo y exacta.
// Los horarios del negocio se calculan en la hora local del servidor (spec 005).
export const localIsoWithOffset = (date) => {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const weekday = (date) => WEEKDAYS[date.getDay()];

// Días calendario {y, m, d} (ambos incluidos) → intervalo semiabierto [desde 00:00, día siguiente a hasta 00:00) local.
export const dayRangeToInterval = (from, to) => ({
  from: new Date(from.y, from.m - 1, from.d),
  to: new Date(to.y, to.m - 1, to.d + 1),
});

// RF-6, RF-8: un slot_id solo vale si un resultado de ver_disponibilidad de esta misma conversación lo emitió.
// El historial está firmado por el servidor, así que el modelo no puede inventar uno ni el cliente fabricarlo.
export const findIssuedSlot = (messages, slotId) => {
  const availabilityCalls = new Set();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === 'tool_use' && block.name === AVAILABILITY_TOOL) availabilityCalls.add(block.id);
      if (block.type !== 'tool_result' || block.is_error || !availabilityCalls.has(block.tool_use_id)) continue;

      let result;
      try { result = JSON.parse(block.content); } catch { continue; }
      const slot = result?.horarios?.find((h) => h.slot_id === slotId);
      if (slot) return { serviceId: result.servicio_id, employeeId: slot.profesional_id, startsAt: new Date(slot.inicio) };
    }
  }
  return null;
};

// RF-4: tope de mensajes del cliente por conversación (también acota el tamaño del historial firmado).
export const MAX_CONVERSATION_MESSAGES = 30;
export const countClientMessages = (messages) =>
  messages.filter((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'text')).length;
