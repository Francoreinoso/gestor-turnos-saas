import { normalizeWindows } from '../domain/availabilityWindows.js';
import { findScopedStaff } from './findScopedStaff.js';
import { toApiWindow } from './getStaffAvailability.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

const EXCLUSION_VIOLATION = '23P01';
const CHECK_VIOLATION = '23514';

// spec 004 — reemplazar el horario semanal completo: RF-3..RF-12.
// Orden (RF-10): alcance (404) → estado (422) → forma (400) → valores (422).
export const replaceStaffAvailability = async (db, { id, accountId, actor, body }, repos) => {
  const user = await findScopedStaff(db, { id, accountId, actor }, repos);
  if (user.status === 'inactivo') throw httpErr(422, 'user_inactive'); // RF-11

  const windows = normalizeWindows(body);

  try {
    const saved = await db.transaction(async (tx) => {
      await repos.users.lockById(tx, id); // serializa reemplazos concurrentes del mismo trabajador
      return repos.availability.replaceForUser(tx, id, windows);
    });
    return saved.map(toApiWindow);
  } catch (err) {
    // Red final: el dominio ya validó; si la DB igual rechaza por constraint, es un 422, no un 500.
    const code = err.cause?.code ?? err.code;
    if (code === EXCLUSION_VIOLATION || code === CHECK_VIOLATION) throw httpErr(422, 'invalid_availability');
    throw err;
  }
};
