// spec 011 — entradas de las herramientas del asistente (RF-10) y de las rutas /assistant/*.
// Las herramientas usan objetos estrictos: una clave de más (por ejemplo un account_id o client_id que el modelo
// intente pasar) se rechaza como invalid_input y no se ejecuta nada. La identidad sale siempre de la sesión.
import { z } from 'zod';
import { rule } from '../validation.js';
import { isUuid } from '../uuid.js';
import { PHONE_REGEX } from '../client.js';

export const MAX_AVAILABILITY_DAYS = 14; // RF-6

const invalidInput = rule('invalid_input');
const toolInput = (shape) => z.strictObject(shape, { error: invalidInput });
const toolUuid = () => z.string({ error: invalidInput }).refine(isUuid, invalidInput);

// Día calendario 'YYYY-MM-DD' que existe (2026-02-30 no).
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const parseDay = (value) => {
  const m = DAY_RE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? { y, m: mo, d } : null;
};

// Días entre dos fechas calendario, contando ambos extremos (independiente de la zona horaria).
export const daysInclusive = (from, to) =>
  Math.round((Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / 86_400_000) + 1;

const day = () => z.string({ error: invalidInput }).refine((v) => parseDay(v) !== null, rule('invalid_date'));

export const listarServiciosInput = toolInput({});

// Zod 4 corre los refine del objeto aunque un campo ya haya fallado: con una fecha inválida no se compara nada.
const rangeDays = (i) => {
  const from = parseDay(i.desde);
  const to = parseDay(i.hasta);
  return from && to ? daysInclusive(from, to) : 1;
};

export const verDisponibilidadInput = toolInput({
  servicio_id: toolUuid(),
  desde: day(),
  hasta: day(),
})
  .refine((i) => rangeDays(i) >= 1, rule('invalid_range'))
  .refine((i) => rangeDays(i) <= MAX_AVAILABILITY_DAYS, rule('range_too_long'));

export const verMisTurnosInput = toolInput({});

export const proponerReservaInput = toolInput({
  servicio_id: toolUuid(),
  slot_id: z.string({ error: invalidInput }).min(1, invalidInput).max(64, invalidInput),
});

export const cancelarTurnoInput = toolInput({
  turno_id: toolUuid(),
});

// ── Rutas HTTP ────────────────────────────────────────────────────────────────

const accountId = () => z.string({ error: rule('missing_fields') }).refine(isUuid, rule('not_found', 404));

// RF-1: teléfono E.164 básico, igual que el formulario público.
export const startSessionBody = z.object({
  account_id: accountId(),
  phone: z.string({ error: rule('missing_fields') }).refine((v) => PHONE_REGEX.test(v), rule('invalid_phone_format')),
});

export const verifySessionBody = startSessionBody.extend({
  code: z.string({ error: rule('missing_fields') }).regex(/^\d{6}$/, rule('invalid_code', 401)),
});

export const MAX_MESSAGE_CHARS = 2000;

export const messageBody = z.object({
  message: z.string({ error: rule('missing_fields') }).trim().min(1, rule('missing_fields')).max(MAX_MESSAGE_CHARS, rule('message_too_long')),
  // Estado firmado de la conversación que devolvió la respuesta anterior; ausente en el primer mensaje.
  conversation: z.string({ error: rule('invalid_body') }).optional(),
});
