import { assertScheduledAtNotPast } from '../domain/appointmentScheduling.js';
import { createAppointment } from './createAppointment.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

export const rescheduleAppointment = async (db, old, { serviceId, scheduledAt, employeeId, notes, now = new Date() }, repos) => {
  if (old.status !== 'agendado') throw httpErr(422, 'invalid_status_transition');
  // spec 005 RF-10: se valida antes de cancelar el turno viejo; createAppointment repite la guarda.
  assertScheduledAtNotPast(scheduledAt, now);

  return db.transaction(async (tx) => {
    await repos.appointments.update(tx, old.id, { status: 'cancelado' });

    return createAppointment(tx, {
      accountId: old.account_id,
      serviceId: serviceId ?? old.service_id,
      scheduledAt,
      now,
      clientId: old.client_id,
      employeeId: employeeId ?? old.assigned_user_id,
      notes: notes ?? old.notes,
    }, repos);
  });
};
