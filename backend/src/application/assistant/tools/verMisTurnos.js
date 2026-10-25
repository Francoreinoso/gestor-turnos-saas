import { verMisTurnosInput } from '../../../domain/schemas/assistant.js';
import { localIsoWithOffset } from '../../../domain/assistant.js';

const MAX_APPOINTMENTS = 20;

// spec 011 RF-7 — próximos turnos del cliente de la sesión. Lista blanca de campos: ni datos de contacto
// ni notas ni nada de otros clientes.
export const verMisTurnos = {
  name: 'ver_mis_turnos',
  description: 'Lista los próximos turnos del cliente con el que estás conversando (desde ahora en adelante), con su turno_id y estado.',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  schema: verMisTurnosInput,

  run: async ({ db, repos, accountId, clientId, now }) => {
    const rows = await repos.appointments.findForList(db, {
      accountId, filters: { clientId, dateFrom: now }, limit: MAX_APPOINTMENTS,
    });
    return {
      turnos: rows.map((a) => ({
        turno_id: a.id,
        servicio: a.service?.name ?? null,
        profesional: a.assignedUser?.name ?? null,
        inicio: localIsoWithOffset(a.scheduled_at),
        estado: a.status,
      })),
    };
  },
};
