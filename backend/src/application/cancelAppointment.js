import { assertTransition } from '../domain/appointment.js';

export const cancelAppointment = async (db, appointmentId, repos) => {
  const appointment = await repos.appointments.findById(db, appointmentId);
  if (!appointment) return null;

  assertTransition(appointment.status, 'cancelado');
  return repos.appointments.update(db, appointmentId, { status: 'cancelado' });
};
