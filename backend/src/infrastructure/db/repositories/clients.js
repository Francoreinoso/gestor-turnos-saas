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

  // spec 011 RF-19: busca dentro de la cuenta por email y, si no aparece, por teléfono (ambos son únicos por cuenta,
  // migración 0008). Dos altas simultáneas: la segunda choca con el índice, no inserta nada y relee la fila ganadora.
  findOrCreate: async (db, { accountId, email, phone }, defaults) => {
    const find = async () => {
      if (email) {
        const byEmail = await db.query.clients.findFirst({ where: and(eq(clients.account_id, accountId), eq(clients.email, email)) });
        if (byEmail) return byEmail;
      }
      if (phone) return db.query.clients.findFirst({ where: and(eq(clients.account_id, accountId), eq(clients.phone, phone)) });
      return undefined;
    };

    const existing = await find();
    if (existing) return existing;
    const [created] = await db.insert(clients).values(defaults).onConflictDoNothing().returning();
    return created ?? find();
  },
};
