import { generateAccessToken } from '../domain/token.js';
import { toPublicUser } from '../domain/publicUser.js';
import { buildInvitationLink } from '../domain/invitation.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

// spec 002 — reenvío explícito de la invitación: RF-12, RF-13. spec 009 RF-21: devuelve también el enlace.
export const resendStaffInvitation = async (db, { id, accountId, actor, appUrl }, repos) => {
  if (actor.role === 'staff') throw httpErr(403, 'forbidden');

  const user = await repos.users.findVisible(db, { id, accountId });
  if (!user) throw httpErr(404, 'not_found'); // RF-34
  if (user.status !== 'pendiente') throw httpErr(422, 'invalid_status_transition'); // RF-13

  return db.transaction(async (tx) => {
    await repos.invitationTokens.invalidateAllForUser(tx, user.id); // RF-12
    const { token, hash } = generateAccessToken();
    await repos.invitationTokens.create(tx, {
      user_id: user.id,
      token_hash: hash,
      expires_at: new Date(Date.now() + TOKEN_TTL_MS),
    });
    const invitationLink = buildInvitationLink(appUrl, token); // spec 009 RF-21
    await repos.email.sendInvitation({ to: user.email, link: invitationLink }); // RF-15 aplica igual
    return { user: toPublicUser(user), invitation_link: invitationLink };
  });
};
