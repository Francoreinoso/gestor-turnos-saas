import { proponerReservaInput } from '../../../domain/schemas/assistant.js';
import { findIssuedSlot, isExpired, proposalExpiresAt, localIsoWithOffset } from '../../../domain/assistant.js';
import { computeEndsAt } from '../../../domain/appointmentScheduling.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 011 RF-8, RF-13 — crea una propuesta pendiente (vence a los 10 minutos); NO crea el turno. El turno solo
// nace cuando el cliente aprieta Confirmar (POST /assistant/proposals/:id/confirm), sin pasar por el modelo.
// El slot sale del historial firmado: si ver_disponibilidad no lo emitió en esta conversación, es slot_invalid.
export const proponerReserva = {
  name: 'proponer_reserva',
  description: 'Prepara una reserva pendiente para un horario devuelto por ver_disponibilidad. No crea el turno: '
    + 'el cliente lo confirma con el botón Confirmar que aparece en el chat. Tú no puedes confirmar reservas.',
  input_schema: {
    type: 'object',
    properties: {
      servicio_id: { type: 'string', description: 'servicio_id del servicio elegido.' },
      slot_id: { type: 'string', description: 'slot_id exacto de un horario devuelto por ver_disponibilidad para ese servicio.' },
    },
    required: ['servicio_id', 'slot_id'],
    additionalProperties: false,
  },
  schema: proponerReservaInput,

  run: async ({ db, repos, accountId, clientId, now, messages, proposals }, { servicio_id, slot_id }) => {
    const slot = findIssuedSlot(messages, slot_id);
    if (!slot || slot.serviceId !== servicio_id) throw httpErr(422, 'slot_invalid');
    if (slot.startsAt.getTime() <= now.getTime()) throw httpErr(422, 'appointment_in_past');

    const service = await repos.services.findActive(db, servicio_id, accountId);
    if (!service) throw httpErr(404, 'service_not_found');

    // RF-13: si el horario se ocupó desde que se consultó, el modelo recibe el error y ofrece alternativas.
    const end = computeEndsAt(slot.startsAt, service.duration_minutes);
    const taken = await repos.appointments.findBusinessBlock(db, accountId, slot.startsAt, end)
      ?? await repos.appointments.findUserConflict(db, accountId, slot.employeeId, slot.startsAt, end);
    if (taken) throw httpErr(409, 'appointment_overlap');

    const data = {
      account_id: accountId, client_id: clientId, service_id: servicio_id, employee_id: slot.employeeId,
      starts_at: slot.startsAt, expires_at: proposalExpiresAt(now),
    };
    let proposal = await repos.assistantProposals.createPending(db, data);
    // Una pendiente igual pero ya vencida se marca como tal y se propone de nuevo.
    if (isExpired(proposal, now)) {
      await repos.assistantProposals.markStatus(db, proposal.id, 'vencida');
      proposal = await repos.assistantProposals.createPending(db, data);
    }

    const professional = (await repos.users.findVisible(db, { id: slot.employeeId, accountId }))?.name ?? null;
    // La interfaz muestra un botón de confirmación por cada propuesta del turno de chat.
    proposals.push({
      id: proposal.id, service: service.name, professional,
      starts_at: proposal.starts_at.toISOString(), expires_at: proposal.expires_at.toISOString(),
    });

    return {
      propuesta_id: proposal.id,
      servicio: service.name,
      profesional: professional,
      inicio: localIsoWithOffset(proposal.starts_at),
      estado: 'pendiente',
      siguiente_paso: 'Pide al cliente que confirme con el botón Confirmar del chat antes de 10 minutos. La reserva no existe hasta que confirme.',
    };
  },
};
