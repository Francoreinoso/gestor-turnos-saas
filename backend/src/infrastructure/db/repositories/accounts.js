import { eq } from 'drizzle-orm';
import { accounts } from '../../../../db/schema.js';

export const accountRepo = {
  findById: (db, id) =>
    db.query.accounts.findFirst({ where: eq(accounts.id, id) }),

  updateCommission: (db, id, rate) =>
    db.update(accounts).set({ commission_rate: rate }).where(eq(accounts.id, id)).returning().then(r => r[0]),
};
