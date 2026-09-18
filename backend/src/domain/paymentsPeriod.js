// Resolución y validación del filtro de período del resumen financiero (spec 003).
// Puro: recibe `now` explícito, nunca lee el reloj — mismo criterio que appointmentScheduling.js.

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

const PRESETS = ['hoy', 'esta_semana', 'este_mes'];

const startOfDayUTC = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const endOfDayUTC = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

// Lunes como inicio de semana; getUTCDay() da 0=domingo..6=sábado.
const startOfWeekUTC = (d) => {
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday));
};

const resolvePreset = (preset, now) => {
  if (preset === 'hoy') return { from: startOfDayUTC(now), to: endOfDayUTC(now) };

  if (preset === 'esta_semana') {
    const monday = startOfWeekUTC(now);
    const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6));
    return { from: monday, to: endOfDayUTC(sunday) };
  }

  // este_mes
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { from, to };
};

// RF-11..RF-15, RF-17, RF-18
export const resolvePeriod = ({ preset, dateFrom, dateTo, now }) => {
  const hasRange = dateFrom !== undefined || dateTo !== undefined;
  if (preset && hasRange) throw httpErr(400, 'ambiguous_period_filter'); // RF-13

  if (hasRange) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw httpErr(400, 'invalid_period'); // RF-18
    return { from, to }; // RF-15 (inclusive), RF-17 (invertido se devuelve tal cual — D-P3)
  }

  const resolved = preset ?? 'este_mes'; // RF-12
  if (!PRESETS.includes(resolved)) throw httpErr(400, 'invalid_period'); // RF-18

  return resolvePreset(resolved, now); // RF-11, RF-14
};
