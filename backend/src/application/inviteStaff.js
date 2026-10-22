import { normalizeEmail } from '../domain/client.js';
import { generateAccessToken } from '../domain/token.js';
import { parseInput } from '../domain/validation.js';
import { inviteStaffBody } from '../domain/schemas/staff.js';
import { decideInviteAction } from '../domain/staffInvite.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // RF-9

// spec 002 — invitar (alta) de un trabajador: RF-1..RF-9, RF-13..RF-15.
// spec 008 RF-4: recibe el `body` crudo; la forma (incluido un body ausente o que no es objeto → 400 invalid_body) la valida
// parseInput, después del chequeo de rol.
export const inviteStaff = async (db, { accountId, actor, body }, repos) => {
  if (actor.role === 'staff') throw httpErr(403, 'forbidden'); // RF-14
  const { name, email, commission_rate: commissionRate } = parseInput(inviteStaffBody, body); // RF-5, RF-4

  const normalized = normalizeEmail(email);
  const existingUser = await repos.users.findByEmail(db, normalized);
  const action = decideInviteAction({ existingUser, accountId }); // RF-6/RF-7/RF-8

  if (action === 'reject') throw httpErr(409, 'email_taken'); // RF-6

  return db.transaction(async (tx) => {
    let user;
    if (action === 'create') {
      user = await repos.users.create(tx, {
        account_id: accountId,
        name,
        email: normalized,
        role: 'staff',
        status: 'pendiente',
        commission_rate: commissionRate ?? null,
      }); // RF-1, RF-2, RF-3
    } else {
      // reactivate (RF-7) o resend (RF-8): misma fila, vuelve a pendiente
      user = await repos.users.update(tx, existingUser.id, {
        name,
        email: normalized,
        status: 'pendiente',
        commission_rate: commissionRate ?? null,
      });
      await repos.invitationTokens.invalidateAllForUser(tx, user.id);
    }

    const { token, hash } = generateAccessToken();
    await repos.invitationTokens.create(tx, {
      user_id: user.id,
      token_hash: hash,
      expires_at: new Date(Date.now() + TOKEN_TTL_MS),
    });

    // RF-15: el envío ocurre dentro de la transacción — si falla, el rollback deja todo intacto.
    await repos.email.sendInvitation({ to: user.email, link: token });

    return { user, action };
  });
};
