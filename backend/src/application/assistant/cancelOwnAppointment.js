import { assertTransition } from '../../domain/appointment.js';
import { isUuid } from '../../domain/uuid.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 011 RF-9 — el cliente del asistente cancela un turno agendado propio. La identidad (cuenta y cliente)
// sale de la sesión: un turno ajeno, de otra cuenta o inexistente es indistinguible (404).
export const cancelOwnAppointment = async (db, { accountId, clientId, appointmentId }, repos) => {
  if (!isUuid(appointmentId)) throw httpErr(404, 'not_found');

  const appointment = await repos.appointments.findForClient(db, { id: appointmentId, accountId, clientId });
  if (!appointment) throw httpErr(404, 'not_found');

  // Igual que spec 001 RF-44/RF-45: solo se cancela lo agendado; un bloqueo no es de ningún cliente.
  if (appointment.status !== 'agendado') throw httpErr(422, 'invalid_status_transition');

  assertTransition(appointment.status, 'cancelado');
  return repos.appointments.update(db, appointment.id, { status: 'cancelado' });
};
