import { assertTransition } from '../domain/userStatus.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 002 — dar de baja a un trabajador: RF-25..RF-29.
export const deactivateStaff = async (db, { id, accountId, actor, now = new Date() }, repos) => {
  if (actor.role === 'staff') throw httpErr(403, 'forbidden'); // RF-29, antes de cargar el recurso

  const user = await repos.users.findVisible(db, { id, accountId });
  if (!user) throw httpErr(404, 'not_found'); // RF-34
  assertTransition(user.status, 'inactivo'); // RF-28: 422 si ya está inactivo

  return db.transaction(async (tx) => {
    const updated = await repos.users.update(tx, id, { status: 'inactivo' }); // RF-25
    await repos.appointments.cancelFutureForUser(tx, { userId: id, now }); // RF-26, RF-27
    return { user: updated };
  });
};
