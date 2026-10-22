// Reglas puras de tiempo y estado inicial de un turno (spec 001).

const MS_PER_MINUTE = 60 * 1000;

// RF-2 / RF-12: fin = inicio + duración; la duración debe ser un número positivo de minutos.
export const computeEndsAt = (startsAt, durationMinutes) => {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    const err = new Error('invalid_service_duration');
    err.status = 422;
    throw err;
  }
  return new Date(startsAt.getTime() + durationMinutes * MS_PER_MINUTE);
};

// RF-1 / RF-9: un turno cuyo fin ya pasó nace 'completado'; el resto nace 'agendado'.
export const resolveInitialStatus = (endsAt, now) =>
  endsAt.getTime() <= now.getTime() ? 'completado' : 'agendado';

// Solapamiento con intervalos semiabiertos [inicio, fin): dos turnos adyacentes no se solapan.
export const overlaps = (aStart, aEnd, bStart, bEnd) =>
  aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();

// spec 003 RF-19/RF-20: la corrección completado↔no_llego solo vale hasta el
// día calendario UTC siguiente al del turno; pasado eso, rechaza (422).
export const assertCorrectionWindow = (scheduledAt, now) => {
  const windowEnd = new Date(Date.UTC(
    scheduledAt.getUTCFullYear(), scheduledAt.getUTCMonth(), scheduledAt.getUTCDate() + 1,
    23, 59, 59, 999,
  ));
  if (now.getTime() > windowEnd.getTime()) {
    const err = new Error('correction_window_expired');
    err.status = 422;
    throw err;
  }
};

// spec 005 RF-10 / RF-10b: las rutas públicas no ofrecen ni aceptan inicios en el pasado.
// Devuelve el inicio ya parseado; un valor que no es string/Date ISO válido → 400, inicio <= now → 422.
export const assertScheduledAtNotPast = (value, now) => {
  const start = typeof value === 'string' || value instanceof Date ? new Date(value) : new Date(NaN);
  if (Number.isNaN(start.getTime())) {
    const err = new Error('invalid_scheduled_at');
    err.status = 400;
    throw err;
  }
  if (start.getTime() <= now.getTime()) {
    const err = new Error('appointment_in_past');
    err.status = 422;
    throw err;
  }
  return start;
};
