import { assertEditablePayload } from '../domain/appointmentEdit.js';
import { computeEndsAt } from '../domain/appointmentScheduling.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const isOverlap = (err) => (err.cause?.message ?? err.message) === 'appointment_overlap';

// spec 001 — edición in-place de un turno agendado (RF-19..RF-29, RF-33).
export const editAppointment = async (db, { id, accountId, actor, body }, repos) => {
  const changes = assertEditablePayload(body); // RF-21 / RF-22

  const appointment = await repos.appointments.findVisible(db, { id, accountId });
  if (!appointment) throw httpErr(404, 'not_found'); // RF-34
  if (actor.role === 'staff' && appointment.assigned_user_id !== actor.id) throw httpErr(404, 'not_found');

  // RF-33: un staff no puede reasignar su turno a otro profesional.
  if (actor.role === 'staff' && 'assigned_user_id' in changes && changes.assigned_user_id !== actor.id) {
    throw httpErr(403, 'forbidden');
  }

  // RF-23: solo se edita un turno agendado.
  if (appointment.status !== 'agendado') throw httpErr(422, 'invalid_status_transition');

  const patch = { ...changes };

  // RF-26 + RF-25: servicio nuevo válido y recálculo del fin sobre el mismo inicio.
  if ('service_id' in changes) {
    const service = await repos.services.findActive(db, changes.service_id, accountId);
    if (!service) throw httpErr(404, 'service_not_found');
    patch.scheduled_until = computeEndsAt(appointment.scheduled_at, service.duration_minutes);
  }

  // RF-27: cliente nuevo de la cuenta.
  if ('client_id' in changes) {
    const client = await repos.clients.findById(db, changes.client_id);
    if (!client || client.account_id !== accountId) throw httpErr(404, 'client_not_found');
  }

  // RF-28: profesional nuevo de la cuenta.
  if ('assigned_user_id' in changes) {
    const user = await repos.users.findById(db, changes.assigned_user_id);
    if (!user || user.account_id !== accountId) throw httpErr(404, 'professional_not_found');
  }

  // RF-29: el estado final (servicio/profesional ya aplicados en `patch`) se valida contra
  // el trigger BEFORE UPDATE, que deja la fila intacta si hay solapamiento.
  // ponytail: sin pre-check en la app — findUserConflict no excluye la propia fila; el trigger basta.
  try {
    return await repos.appointments.update(db, id, patch);
  } catch (err) {
    if (isOverlap(err)) throw httpErr(409, 'appointment_overlap');
    throw err;
  }
};
