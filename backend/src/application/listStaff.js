const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 002 — listado de trabajadores de la cuenta: RF-31, RF-32, RF-33.
export const listStaff = async (db, { accountId, actor, status }, repos) => {
  if (actor.role === 'staff') throw httpErr(403, 'forbidden'); // RF-33
  return { staff: await repos.users.findManyByAccount(db, accountId, { status }) }; // RF-31, RF-32
};
