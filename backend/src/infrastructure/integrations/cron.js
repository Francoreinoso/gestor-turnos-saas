import cron from 'node-cron';
import { eq, and, lte, gt } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as repos from '../db/repositories/index.js';
import { appointments } from '../../../db/schema.js';
import { createPayment } from '../../application/createPayment.js';

// Automatic state transitions: agendado → en_progreso → completado
export const startCron = () => cron.schedule('* * * * *', async () => {
  const now = new Date();
  try {
    await db.update(appointments)
      .set({ status: 'en_progreso' })
      .where(and(eq(appointments.status, 'agendado'), lte(appointments.scheduled_at, now), gt(appointments.scheduled_until, now)));

    const completed = await db.update(appointments)
      .set({ status: 'completado' })
      .where(and(eq(appointments.status, 'en_progreso'), lte(appointments.scheduled_until, now)))
      .returning();

    for (const apt of completed) {
      await createPayment(db, apt, repos).catch(err =>
        console.error(`payment failed for appointment ${apt.id}:`, err.message)
      );
    }
  } catch (err) {
    console.error('cron error:', err.message);
  }
});
