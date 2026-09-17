import { eq, and, isNull, gt } from 'drizzle-orm';
import { staffInvitationTokens } from '../../../../db/schema.js';

export const staffInvitationTokenRepo = {
  create: (db, data) =>
    db.insert(staffInvitationTokens).values(data).returning().then(r => r[0]),

  // RF-10: válido = no vencido y no usado todavía
  findValidByHash: (db, tokenHash) =>
    db.query.staffInvitationTokens.findFirst({
      where: and(
        eq(staffInvitationTokens.token_hash, tokenHash),
        isNull(staffInvitationTokens.used_at),
        gt(staffInvitationTokens.expires_at, new Date()),
      ),
    }),

  // RF-8, RF-12: invalida cualquier enlace anterior sin vencer todavía
  invalidateAllForUser: (db, userId) =>
    db.update(staffInvitationTokens)
      .set({ used_at: new Date() })
      .where(and(eq(staffInvitationTokens.user_id, userId), isNull(staffInvitationTokens.used_at))),

  markUsed: (db, id) =>
    db.update(staffInvitationTokens).set({ used_at: new Date() }).where(eq(staffInvitationTokens.id, id)),
};
