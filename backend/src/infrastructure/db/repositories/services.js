import { eq, and } from 'drizzle-orm';
import { services, servicePriceHistories } from '../../../../db/schema.js';

export const serviceRepo = {
  findById: (db, id, accountId) =>
    db.query.services.findFirst({ where: and(eq(services.id, id), eq(services.account_id, accountId)) }),

  findActive: (db, id, accountId) =>
    db.query.services.findFirst({
      where: and(eq(services.id, id), eq(services.account_id, accountId), eq(services.active, true)),
    }),

  findAll: (db, accountId, filters = {}) => {
    const conditions = [eq(services.account_id, accountId)];
    if (filters.active !== undefined) conditions.push(eq(services.active, filters.active));
    return db.query.services.findMany({ where: and(...conditions) });
  },

  create: (db, data) =>
    db.insert(services).values(data).returning().then(r => r[0]),

  update: (db, id, data) =>
    db.update(services).set(data).where(eq(services.id, id)).returning().then(r => r[0]),

  addPriceHistory: (db, serviceId, price) =>
    db.insert(servicePriceHistories).values({ service_id: serviceId, price }),
};
