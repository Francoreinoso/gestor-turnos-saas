import { toPublicUser } from '../domain/publicUser.js';
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 002 — ver el detalle de un trabajador: RF-34.
export const getStaff = async (db, { id, accountId }, repos) => {
  const user = await repos.users.findVisible(db, { id, accountId });
  if (!user) throw httpErr(404, 'not_found');
  return { user: toPublicUser(user) };
};
