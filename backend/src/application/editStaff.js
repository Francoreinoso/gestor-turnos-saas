import { normalizeEmail } from '../domain/client.js';
import { generateAccessToken } from '../domain/token.js';
import { parseInput } from '../domain/validation.js';
import { editStaffBody } from '../domain/schemas/staff.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

// spec 002 — el owner edita a un trabajador de su cuenta: RF-16..RF-19, RF-22..RF-24.
export const editStaff = async (db, { id, accountId, actor, body }, repos) => {
  if (actor.role === 'staff') throw httpErr(404, 'not_found'); // RF-24: la edición de otro trabajador está fuera de su alcance

  const changes = parseInput(editStaffBody, body); // RF-23, RF-4

  const user = await repos.users.findVisible(db, { id, accountId });
  if (!user) throw httpErr(404, 'not_found'); // RF-34
  if (user.status === 'inactivo') throw httpErr(422, 'invalid_status_transition'); // RF-17

  let emailChanged = false;
  if ('email' in changes) {
    const normalized = normalizeEmail(changes.email);
    if (normalized !== user.email) {
      const other = await repos.users.findByEmail(db, normalized);
      if (other && other.id !== user.id) throw httpErr(409, 'email_taken'); // RF-22: nunca reactiva
      emailChanged = true;
    }
    changes.email = normalized;
  }

  // RF-18: solo un trabajador pendiente reemite invitación al cambiar el email.
  if (!(emailChanged && user.status === 'pendiente')) {
    return { user: await repos.users.update(db, id, changes) }; // RF-16, RF-19
  }

  return db.transaction(async (tx) => {
    const updated = await repos.users.update(tx, id, changes);
    await repos.invitationTokens.invalidateAllForUser(tx, id);
    const { token, hash } = generateAccessToken();
    await repos.invitationTokens.create(tx, {
      user_id: id,
      token_hash: hash,
      expires_at: new Date(Date.now() + TOKEN_TTL_MS),
    });
    await repos.email.sendInvitation({ to: updated.email, link: token });
    return { user: updated };
  });
};
