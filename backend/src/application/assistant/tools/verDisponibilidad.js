import { randomBytes } from 'crypto';
import { verDisponibilidadInput, parseDay, MAX_AVAILABILITY_DAYS } from '../../../domain/schemas/assistant.js';
import { AVAILABILITY_TOOL, dayRangeToInterval, localIsoWithOffset, weekday } from '../../../domain/assistant.js';
import { listAvailableSlots } from '../../listAvailableSlots.js';

// Tope de horarios por respuesta: acota el historial firmado y lo que lee el modelo.
export const MAX_SLOTS = 30;

const newSlotId = () => `s_${randomBytes(6).toString('hex')}`;

// spec 011 RF-6 — horarios libres de un servicio en un rango de hasta 14 días. Cada horario lleva un slot_id
// opaco; proponer_reserva solo acepta slot_id que aparezcan en un resultado de esta herramienta en la conversación.
export const verDisponibilidad = {
  name: AVAILABILITY_TOOL,
  description: `Devuelve los horarios libres de un servicio entre dos fechas (incluidas), con un máximo de ${MAX_AVAILABILITY_DAYS} días. `
    + 'Cada horario trae un slot_id: es el único dato válido para proponer una reserva. Si hay_mas es true, acota el rango para ver el resto.',
  input_schema: {
    type: 'object',
    properties: {
      servicio_id: { type: 'string', description: 'servicio_id devuelto por listar_servicios.' },
      desde: { type: 'string', description: 'Primer día a consultar, formato YYYY-MM-DD.' },
      hasta: { type: 'string', description: 'Último día a consultar (incluido), formato YYYY-MM-DD.' },
    },
    required: ['servicio_id', 'desde', 'hasta'],
    additionalProperties: false,
  },
  schema: verDisponibilidadInput,

  run: async ({ db, repos, accountId, now }, { servicio_id, desde, hasta }) => {
    const { from, to } = dayRangeToInterval(parseDay(desde), parseDay(hasta));
    const slots = await listAvailableSlots(db, { businessId: accountId, serviceId: servicio_id, from, to, now }, repos);
    const names = new Map((await repos.users.findManyByAccount(db, accountId, { status: 'activo' })).map((u) => [u.id, u.name]));

    const sorted = slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || (names.get(a.employee_id) ?? '').localeCompare(names.get(b.employee_id) ?? ''));
    return {
      servicio_id,
      horarios: sorted.slice(0, MAX_SLOTS).map((s) => {
        const start = new Date(s.starts_at);
        return {
          slot_id: newSlotId(),
          dia: weekday(start),
          inicio: localIsoWithOffset(start),
          profesional_id: s.employee_id,
          profesional: names.get(s.employee_id) ?? '',
        };
      }),
      hay_mas: sorted.length > MAX_SLOTS,
    };
  },
};
