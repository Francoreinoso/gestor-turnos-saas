import { parseInput } from '../domain/validation.js';
import { listAppointmentsQuery } from '../domain/schemas/appointments.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

const LIST_LIMIT = 500; // RF-41

const parseDate = (value) => {
  if (value === undefined) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw httpErr(400, 'invalid_date'); // RF-39
  return d;
};

// spec 001 — listado de turnos de la cuenta con filtros (RF-36..RF-42).
export const listAppointments = async (db, { accountId, actor, query: rawQuery = {} }, repos) => {
  const query = parseInput(listAppointmentsQuery, rawQuery);
  const status = query.status ?? query.type; // RF-37: `type` es alias de `status`
  const dateFrom = parseDate(query.date_from);
  const dateTo = parseDate(query.date_to);

  // RF-42: el staff solo ve lo suyo.
  const employeeId = actor.role === 'staff' ? actor.id : query.employee_id;

  // RF-40: rango invertido → lista vacía, sin error.
  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) return [];

  return repos.appointments.findForList(db, {
    accountId,
    filters: { status, employeeId, dateFrom, dateTo },
    limit: LIST_LIMIT,
  });
};
