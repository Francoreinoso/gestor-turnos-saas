const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 004 RF-13..RF-15 — el trabajador (rol staff) de la cuenta sobre el que el actor puede operar.
// Cuenta ajena, inexistente, id de un owner o (siendo staff) un compañero → 404, nunca 403.
export const findScopedStaff = async (db, { id, accountId, actor }, repos) => {
  const user = await repos.users.findVisible(db, { id, accountId });
  if (!user || user.role !== 'staff') throw httpErr(404, 'not_found');
  if (actor.role === 'staff' && actor.id !== user.id) throw httpErr(404, 'not_found');
  return user;
};
