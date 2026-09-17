import bcrypt from 'bcrypt';
import { createHash } from 'crypto';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 002 — el trabajador define su contraseña vía el enlace de invitación: RF-10, RF-11.
export const activateStaffAccount = async (db, { token, password }, repos) => {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const record = await repos.invitationTokens.findValidByHash(db, tokenHash);
  if (!record) throw httpErr(410, 'token_expired'); // RF-10

  const passwordHash = await bcrypt.hash(password, 10);

  return db.transaction(async (tx) => {
    const user = await repos.users.update(tx, record.user_id, {
      password_hash: passwordHash,
      status: 'activo',
    }); // RF-11
    await repos.invitationTokens.markUsed(tx, record.id);
    return { user };
  });
};
