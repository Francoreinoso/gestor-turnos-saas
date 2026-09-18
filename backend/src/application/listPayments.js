import { resolvePeriod } from '../domain/paymentsPeriod.js';

const LIST_LIMIT = 500; // mismo valor que el listado de turnos (listAppointments.js RF-41)

// spec 003 RF-8..RF-10 — listado detallado de pagos del período.
export const listPayments = async (db, { accountId, actor, query = {}, now }, repos) => {
  const { from, to } = resolvePeriod({
    preset: query.period,
    dateFrom: query.date_from,
    dateTo: query.date_to,
    now,
  });

  // RF-9: mismo alcance por rol que el resumen — el staff solo ve lo suyo.
  const employeeId = actor.role === 'staff' ? actor.id : query.employee_id;

  const rows = await repos.payments.findForList(db, { accountId, employeeId, from, to, limit: LIST_LIMIT + 1 });

  const hasMore = rows.length > LIST_LIMIT; // RF-10: corta en silencio, indica que hay más
  return { payments: hasMore ? rows.slice(0, LIST_LIMIT) : rows, hasMore };
};
