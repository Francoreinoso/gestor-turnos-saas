// spec 004 — validación pura del horario semanal de un trabajador.

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// RF-7: solo HH:MM de 00:00 a 23:59.
export const timeToMinutes = (time) => {
  if (typeof time !== 'string' || !TIME_REGEX.test(time)) throw httpErr(422, 'invalid_time_format');
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

// RF-2: la base guarda HH:MM:SS; la API expone HH:MM.
export const formatTime = (time) => time.slice(0, 5);

const hasField = (obj, key) => obj[key] !== undefined && obj[key] !== null;

// Devuelve el horario validado y ordenado por día e inicio. Forma → 400, valores → 422.
export const normalizeWindows = (body) => {
  // RF-5: forma
  if (!Array.isArray(body)) throw httpErr(400, 'invalid_body');
  for (const win of body) {
    if (typeof win !== 'object' || win === null || Array.isArray(win)) throw httpErr(400, 'invalid_window');
    if (!['day_of_week', 'start_time', 'end_time'].every(k => hasField(win, k))) throw httpErr(400, 'missing_fields');
  }

  // RF-6, RF-7, RF-8: valores
  const windows = body.map(({ day_of_week, start_time, end_time }) => {
    if (!Number.isInteger(day_of_week) || day_of_week < 0 || day_of_week > 6) throw httpErr(422, 'invalid_day_of_week');
    const start = timeToMinutes(start_time);
    const end = timeToMinutes(end_time);
    if (start >= end) throw httpErr(422, 'start_must_be_before_end');
    return { day_of_week, start_time, end_time, start, end };
  }).sort((a, b) => a.day_of_week - b.day_of_week || a.start - b.start);

  // RF-9: intervalos [inicio, fin). Ordenadas por día e inicio, basta comparar cada ventana con la anterior:
  // si todos los pares contiguos son disjuntos, ninguna ventana solapa con otra.
  for (let i = 1; i < windows.length; i++) {
    const prev = windows[i - 1];
    if (prev.day_of_week === windows[i].day_of_week && windows[i].start < prev.end) throw httpErr(422, 'overlapping_windows');
  }

  return windows.map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time }));
};
