import { eq, and } from 'drizzle-orm';
import { users, availability } from '../../../../db/schema.js';

export const userRepo = {
  findByEmail: (db, email) =>
    db.query.users.findFirst({ where: eq(users.email, email) }),

  findById: (db, id) =>
    db.query.users.findFirst({ where: eq(users.id, id) }),

  create: (db, data) =>
    db.insert(users).values(data).returning().then(r => r[0]),

  // Returns users with their availability for a given account, optionally filtered by id
  findWithAvailability: (db, accountId, userId = null) => {
    const conditions = [eq(users.account_id, accountId)];
    if (userId) conditions.push(eq(users.id, userId));
    return db.query.users.findMany({
      where: and(...conditions),
      with: { availability: true },
    });
  },
};
