import { eq, asc } from 'drizzle-orm';
import { availability } from '../../../../db/schema.js';

export const availabilityRepo = {
  // spec 004 RF-1: ventanas de un trabajador, ordenadas por día e inicio.
  findByUser: (db, userId) =>
    db.query.availability.findMany({
      where: eq(availability.user_id, userId),
      orderBy: [asc(availability.day_of_week), asc(availability.start_time)],
    }),

  // spec 004 RF-3, RF-4: reemplazo total. El caller aporta la transacción (todo o nada).
  replaceForUser: async (db, userId, windows) => {
    await db.delete(availability).where(eq(availability.user_id, userId));
    if (windows.length === 0) return [];
    return db.insert(availability)
      .values(windows.map(({ day_of_week, start_time, end_time }) => ({ user_id: userId, day_of_week, start_time, end_time })))
      .returning();
  },
};
