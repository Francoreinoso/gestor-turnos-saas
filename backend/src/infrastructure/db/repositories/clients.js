import { eq, and } from 'drizzle-orm';
import { clients } from '../../../../db/schema.js';

export const clientRepo = {
  findById: (db, id) =>
    db.query.clients.findFirst({ where: eq(clients.id, id) }),

  findOne: (db, conditions) =>
    db.query.clients.findFirst({ where: and(...conditions) }),

  findAll: (db, accountId) =>
    db.query.clients.findMany({ where: eq(clients.account_id, accountId) }),

  create: (db, data) =>
    db.insert(clients).values(data).returning().then(r => r[0]),

  update: (db, id, data) =>
    db.update(clients).set(data).where(eq(clients.id, id)).returning().then(r => r[0]),

  findOrCreate: async (db, { accountId, email, phone }, defaults) => {
    const where = email
      ? and(eq(clients.account_id, accountId), eq(clients.email, email))
      : and(eq(clients.account_id, accountId), eq(clients.phone, phone));

    const existing = await db.query.clients.findFirst({ where });
    if (existing) return existing;
    return db.insert(clients).values(defaults).returning().then(r => r[0]);
  },
};
