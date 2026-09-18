import { eq, and, gte, lte, desc, sql, count } from 'drizzle-orm';
import { payments, appointments, users } from '../../../../db/schema.js';

const sumField = (column) => sql`coalesce(sum(${column}), 0)`.mapWith(Number);

const scopeConditions = ({ accountId, employeeId, from, to }) => {
  const conditions = [
    eq(payments.account_id, accountId),
    gte(appointments.scheduled_at, from),
    lte(appointments.scheduled_at, to),
  ];
  if (employeeId) conditions.push(eq(payments.assigned_user_id, employeeId));
  return conditions;
};

export const paymentRepo = {
  create: (db, data) =>
    db.insert(payments).values(data).returning().then(r => r[0]),

  deleteByAppointment: (db, appointmentId) =>
    db.delete(payments).where(eq(payments.appointment_id, appointmentId)),

  // spec 003 RF-1, RF-4, RF-5, RF-6, RF-16 — totales agregados del período.
  // SUM ignora NULL de forma nativa (pagos de "contrato fijo", D8 del spec).
  summarize: async (db, params) => {
    const [row] = await db
      .select({
        totalAmount: sumField(payments.amount),
        employeeAmount: sumField(payments.employee_amount),
        businessAmount: sumField(payments.business_amount),
        paymentCount: count(payments.id),
      })
      .from(payments)
      .innerJoin(appointments, eq(payments.appointment_id, appointments.id))
      .where(and(...scopeConditions(params)));

    return row;
  },

  // RF-2, RF-3 — desglose por profesional; una fila por profesional con al
  // menos un pago. El innerJoin a `users` excluye por construcción cualquier
  // pago sin `assigned_user_id` (no debería ocurrir — baja lógica de usuarios).
  summarizeByEmployee: (db, params) =>
    db
      .select({
        employeeId: payments.assigned_user_id,
        employeeName: users.name,
        totalAmount: sumField(payments.amount),
        employeeAmount: sumField(payments.employee_amount),
        businessAmount: sumField(payments.business_amount),
      })
      .from(payments)
      .innerJoin(appointments, eq(payments.appointment_id, appointments.id))
      .innerJoin(users, eq(payments.assigned_user_id, users.id))
      .where(and(...scopeConditions(params)))
      .groupBy(payments.assigned_user_id, users.name),

  // RF-8, RF-9, RF-16 — listado detallado, ordenado por la fecha del turno.
  // `limit` lo decide el caller (application/listPayments.js pide limit+1, D-P2).
  findForList: (db, { limit, ...params }) =>
    db
      .select({
        id: payments.id,
        appointmentId: payments.appointment_id,
        scheduledAt: appointments.scheduled_at,
        employeeId: payments.assigned_user_id,
        employeeName: users.name,
        amount: payments.amount,
        employeeAmount: payments.employee_amount,
        businessAmount: payments.business_amount,
      })
      .from(payments)
      .innerJoin(appointments, eq(payments.appointment_id, appointments.id))
      .leftJoin(users, eq(payments.assigned_user_id, users.id))
      .where(and(...scopeConditions(params)))
      .orderBy(desc(appointments.scheduled_at))
      .limit(limit),
};
