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
