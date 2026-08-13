import { eq, and, ne, lt, gt, lte, gte, isNull, or } from 'drizzle-orm';
import { appointments } from '../../../../db/schema.js';

export const appointmentRepo = {
  findById: (db, id) =>
    db.query.appointments.findFirst({ where: eq(appointments.id, id) }),

  findOne: (db, conditions) =>
    db.query.appointments.findFirst({ where: and(...conditions) }),

  findAll: (db, conditions, options = {}) =>
    db.query.appointments.findMany({ where: and(...conditions), ...options }),

  create: (db, data) =>
    db.insert(appointments).values(data).returning().then(r => r[0]),

  update: (db, id, data) =>
    db.update(appointments).set(data).where(eq(appointments.id, id)).returning().then(r => r[0]),

  delete: (db, id) =>
    db.delete(appointments).where(eq(appointments.id, id)),

  // Finds a business-wide block (assigned_user_id IS NULL) overlapping the given range
  findBusinessBlock: (db, accountId, scheduledAt, scheduledUntil) =>
    db.query.appointments.findFirst({
      where: and(
        eq(appointments.account_id, accountId),
        isNull(appointments.assigned_user_id),
        ne(appointments.status, 'cancelado'),
        lt(appointments.scheduled_at, scheduledUntil),
        gt(appointments.scheduled_until, scheduledAt),
      ),
    }),

  // Finds a conflict for a specific user in the given range
  findUserConflict: (db, accountId, userId, scheduledAt, scheduledUntil) =>
    db.query.appointments.findFirst({
      where: and(
        eq(appointments.account_id, accountId),
        eq(appointments.assigned_user_id, userId),
        ne(appointments.status, 'cancelado'),
        lt(appointments.scheduled_at, scheduledUntil),
        gt(appointments.scheduled_until, scheduledAt),
      ),
    }),
};
