import { assertTransition } from '../domain/appointment.js';

export const cancelAppointment = async (db, appointmentId, repos) => {
  const appointment = await repos.appointments.findById(db, appointmentId);
  if (!appointment) return null;

  // spec 001 RF-44 / RF-45: esta acción solo cancela turnos agendados.
  // Un bloqueado también admite → cancelado en la máquina de estados, pero se libera
  // por la ruta /cancel-block, no por acá.
  if (appointment.status !== 'agendado') {
    const err = new Error('invalid_status_transition');
    err.status = 422;
    throw err;
  }

  assertTransition(appointment.status, 'cancelado');
  return repos.appointments.update(db, appointmentId, { status: 'cancelado' });
};
