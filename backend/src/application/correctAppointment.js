import { eq } from 'drizzle-orm';
import { appointments } from '../../db/schema.js';
import { assertTransition } from '../domain/appointment.js';
import { assertCorrectionWindow } from '../domain/appointmentScheduling.js';
import { createPayment } from './createPayment.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 001 (comportamiento ya existente) + spec 003 RF-19/RF-20 (ventana de
// corrección nueva). Extraído de routes/appointments.js:119-141 para poder
// testearlo como caso de uso (plan.md D-P4).
export const correctAppointment = async (db, { id, accountId, actor, now }, repos) => {
  const appointment = await repos.appointments.findOne(db, [
    eq(appointments.id, id),
    eq(appointments.account_id, accountId),
  ]);

  if (!appointment) throw httpErr(404, 'not_found');
  // spec 010 RF-1 — mismo alcance que getAppointment, antes de la transición (sin 422 para ajenos)
  if (actor.role === 'staff' && appointment.assigned_user_id !== actor.id) throw httpErr(404, 'not_found');

  const next = appointment.status === 'completado' ? 'no_llego' : 'completado';
  assertTransition(appointment.status, next);
  assertCorrectionWindow(appointment.scheduled_at, now); // RF-19, RF-20 — antes de abrir la transacción

  return db.transaction(async (tx) => {
    const result = await repos.appointments.update(tx, appointment.id, { status: next });
    if (next === 'completado') {
      await createPayment(tx, appointment, repos);
    } else {
      await repos.payments.deleteByAppointment(tx, appointment.id);
    }
    return result;
  });
};
