import { eq, and, ne, lt, gt, lte, gte, isNull, or, inArray } from 'drizzle-orm';
import { appointments } from '../../../../db/schema.js';

// Proyección resumida compartida por listado y detalle (spec 001 RF-36 / RF-43).
const SUMMARY_WITH = {
  client: { columns: { id: true, name: true, email: true, phone: true } },
  service: { columns: { id: true, name: true, duration_minutes: true, price: true } },
  assignedUser: { columns: { id: true, name: true } },
};

export const appointmentRepo = {
  findById: (db, id) =>
    db.query.appointments.findFirst({ where: eq(appointments.id, id) }),

  findOne: (db, conditions) =>
    db.query.appointments.findFirst({ where: and(...conditions) }),

  findAll: (db, conditions, options = {}) =>
    db.query.appointments.findMany({ where: and(...conditions), ...options }),

  // spec 001 RF-36..RF-41: listado acotado a la cuenta, con filtros opcionales y tope de filas.
  findForList: (db, { accountId, filters = {}, limit }) => {
    const { status, employeeId, clientId, dateFrom, dateTo } = filters;
    const conditions = [eq(appointments.account_id, accountId)];
    if (status) conditions.push(eq(appointments.status, status));
    if (employeeId) conditions.push(eq(appointments.assigned_user_id, employeeId));
    if (clientId) conditions.push(eq(appointments.client_id, clientId)); // spec 011 RF-7
    if (dateFrom) conditions.push(gte(appointments.scheduled_at, dateFrom));
    if (dateTo) conditions.push(lte(appointments.scheduled_at, dateTo));

    return db.query.appointments.findMany({
      where: and(...conditions),
      with: SUMMARY_WITH,
      orderBy: (a, { asc }) => [asc(a.scheduled_at)],
      limit,
    });
  },

  // spec 001 RF-34 / RF-43: un turno de la cuenta, con la misma proyección resumida.
  findVisible: (db, { id, accountId }) =>
    db.query.appointments.findFirst({
      where: and(eq(appointments.id, id), eq(appointments.account_id, accountId)),
      with: SUMMARY_WITH,
    }),

  // spec 011 RF-9: un turno solo si es del cliente y la cuenta de la sesión del asistente.
  findForClient: (db, { id, accountId, clientId }) =>
    db.query.appointments.findFirst({
      where: and(eq(appointments.id, id), eq(appointments.account_id, accountId), eq(appointments.client_id, clientId)),
    }),

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

  // spec 002 RF-26/RF-27: al dar de baja a un trabajador, cancela sus turnos agendados
  // y bloqueos futuros; no toca lo que ya pasó ni lo que está en un estado terminal.
  cancelFutureForUser: (db, { userId, now }) =>
    db.update(appointments)
      .set({ status: 'cancelado' })
      .where(and(
        eq(appointments.assigned_user_id, userId),
        inArray(appointments.status, ['agendado', 'bloqueado']),
        gt(appointments.scheduled_at, now),
      )),

  // spec 005 RF-9: turnos no cancelados que solapan [from, to), con las columnas mínimas para calcular disponibilidad.
  findTakenSlots: (db, { accountId, from, to }) =>
    db.query.appointments.findMany({
      where: and(
        eq(appointments.account_id, accountId),
        ne(appointments.status, 'cancelado'),
        lt(appointments.scheduled_at, to),
        gt(appointments.scheduled_until, from),
      ),
      columns: { assigned_user_id: true, scheduled_at: true, scheduled_until: true },
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
