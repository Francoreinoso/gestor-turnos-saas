import cron from 'node-cron';
import { eq, and, lte, gt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appointments } from '../../../db/schema.js';

// Automatic state transitions: agendado → en_progreso → completado
export const startCron = () => cron.schedule('* * * * *', async () => {
  const now = new Date();
  try {
    await db.update(appointments)
      .set({ status: 'en_progreso' })
      .where(and(eq(appointments.status, 'agendado'), lte(appointments.scheduled_at, now), gt(appointments.scheduled_until, now)));

    await db.update(appointments)
      .set({ status: 'completado' })
      .where(and(eq(appointments.status, 'en_progreso'), lte(appointments.scheduled_until, now)));
  } catch (err) {
    console.error('cron error:', err.message);
  }
});
