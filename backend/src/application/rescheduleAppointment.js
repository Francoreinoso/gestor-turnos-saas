import { createAppointment } from './createAppointment.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

export const rescheduleAppointment = async (db, old, { serviceId, scheduledAt, employeeId, notes }, repos) => {
  if (old.status !== 'agendado') throw httpErr(422, 'invalid_status_transition');

  return db.transaction(async (tx) => {
    await repos.appointments.update(tx, old.id, { status: 'cancelado' });

    return createAppointment(tx, {
      accountId: old.account_id,
      serviceId: serviceId ?? old.service_id,
      scheduledAt,
      clientId: old.client_id,
      employeeId: employeeId ?? old.assigned_user_id,
      notes: notes ?? old.notes,
    }, repos);
  });
};
