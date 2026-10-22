import { resolvePeriod } from '../domain/paymentsPeriod.js';
import { parseInput } from '../domain/validation.js';
import { paymentsQuery } from '../domain/schemas/payments.js';

// spec 003 RF-1..RF-7 — resumen financiero agregado, con desglose por
// profesional para el owner (siempre en la misma respuesta, D1 del spec).
export const getPaymentsSummary = async (db, { accountId, actor, query: rawQuery = {}, now }, repos) => {
  const query = parseInput(paymentsQuery, rawQuery);
  const { from, to } = resolvePeriod({
    preset: query.period,
    dateFrom: query.date_from,
    dateTo: query.date_to,
    now,
  });

  // RF-3, RF-6, RF-7: el staff solo ve lo suyo, sin importar el filtro recibido.
  const employeeId = actor.role === 'staff' ? actor.id : query.employee_id;

  const summary = await repos.payments.summarize(db, { accountId, employeeId, from, to }); // RF-1, RF-4, RF-5, RF-6

  if (actor.role !== 'owner') return summary; // RF-7: nunca se consulta el desglose para un staff

  const byEmployee = await repos.payments.summarizeByEmployee(db, { accountId, employeeId, from, to }); // RF-2, RF-3
  return { ...summary, byEmployee };
};
