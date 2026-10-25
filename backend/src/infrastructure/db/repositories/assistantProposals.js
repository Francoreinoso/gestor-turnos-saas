import { eq, and } from 'drizzle-orm';
import { assistantProposals } from '../../../../db/schema.js';

const PENDING = 'pendiente';

// spec 011 RF-8, RF-11, RF-12 — propuestas de reserva del asistente. Siempre se buscan por cuenta y cliente.
export const assistantProposalRepo = {
  // Idempotente: si ya hay una pendiente igual (índice único parcial de la migración 0007), devuelve esa.
  createPending: async (db, data) => {
    const [created] = await db.insert(assistantProposals).values({ ...data, status: PENDING }).onConflictDoNothing().returning();
    if (created) return created;
    return db.query.assistantProposals.findFirst({
      where: and(
        eq(assistantProposals.client_id, data.client_id),
        eq(assistantProposals.service_id, data.service_id),
        eq(assistantProposals.employee_id, data.employee_id),
        eq(assistantProposals.starts_at, data.starts_at),
        eq(assistantProposals.status, PENDING),
      ),
    });
  },

  findForClient: (db, { id, accountId, clientId }) =>
    db.query.assistantProposals.findFirst({
      where: and(eq(assistantProposals.id, id), eq(assistantProposals.account_id, accountId), eq(assistantProposals.client_id, clientId)),
    }),

  // Serializa confirmaciones concurrentes de la misma propuesta. Solo dentro de una transacción.
  lockForClient: (tx, { id, accountId, clientId }) =>
    tx.select().from(assistantProposals)
      .where(and(eq(assistantProposals.id, id), eq(assistantProposals.account_id, accountId), eq(assistantProposals.client_id, clientId)))
      .for('update')
      .then(r => r[0]),

  // Solo una pendiente pasa a confirmada; devuelve undefined si ya no lo estaba.
  markConfirmed: (db, id, appointmentId) =>
    db.update(assistantProposals)
      .set({ status: 'confirmada', appointment_id: appointmentId })
      .where(and(eq(assistantProposals.id, id), eq(assistantProposals.status, PENDING)))
      .returning()
      .then(r => r[0]),

  // pendiente → vencida | descartada.
  markStatus: (db, id, status) =>
    db.update(assistantProposals)
      .set({ status })
      .where(and(eq(assistantProposals.id, id), eq(assistantProposals.status, PENDING)))
      .returning()
      .then(r => r[0]),
};
