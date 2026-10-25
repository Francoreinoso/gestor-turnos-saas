import { cancelarTurnoInput } from '../../../domain/schemas/assistant.js';
import { localIsoWithOffset } from '../../../domain/assistant.js';
import { cancelOwnAppointment } from '../cancelOwnAppointment.js';

// spec 011 RF-9, RF-15 — cancela un turno agendado del cliente de la sesión. Uno ajeno, de otra cuenta o
// inexistente da not_found. La confirmación explícita previa (RF-15) la pide el modelo en el chat.
export const cancelarTurno = {
  name: 'cancelar_turno',
  description: 'Cancela un turno agendado del cliente. Antes de usarla, muestra el turno al cliente y espera que confirme '
    + 'explícitamente en el chat que quiere cancelarlo. Usa el turno_id devuelto por ver_mis_turnos.',
  input_schema: {
    type: 'object',
    properties: {
      turno_id: { type: 'string', description: 'turno_id devuelto por ver_mis_turnos.' },
    },
    required: ['turno_id'],
    additionalProperties: false,
  },
  schema: cancelarTurnoInput,

  run: async ({ db, repos, accountId, clientId }, { turno_id }) => {
    const appointment = await cancelOwnAppointment(db, { accountId, clientId, appointmentId: turno_id }, repos);
    return { turno_id: appointment.id, inicio: localIsoWithOffset(appointment.scheduled_at), estado: appointment.status };
  },
};
