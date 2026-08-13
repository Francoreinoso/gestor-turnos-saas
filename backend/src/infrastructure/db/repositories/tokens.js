import { eq, and } from 'drizzle-orm';
import { appointmentAccessTokens } from '../../../../db/schema.js';

export const tokenRepo = {
  findByAppointmentAndHash: (db, appointmentId, tokenHash) =>
    db.query.appointmentAccessTokens.findFirst({
      where: and(
        eq(appointmentAccessTokens.appointment_id, appointmentId),
        eq(appointmentAccessTokens.token_hash, tokenHash),
      ),
    }),

  create: (db, data) =>
    db.insert(appointmentAccessTokens).values(data).returning().then(r => r[0]),
};
