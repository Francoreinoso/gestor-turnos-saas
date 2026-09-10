import { eq } from 'drizzle-orm';
import { payments } from '../../../../db/schema.js';

export const paymentRepo = {
  create: (db, data) =>
    db.insert(payments).values(data).returning().then(r => r[0]),

  deleteByAppointment: (db, appointmentId) =>
    db.delete(payments).where(eq(payments.appointment_id, appointmentId)),
};
