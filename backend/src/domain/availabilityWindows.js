// spec 004 — horario semanal de un trabajador. La forma y los valores (HH:MM, día 0–6, inicio < fin) los valida
// domain/schemas/staff.js (spec 007); acá queda la regla de negocio: orden y solapamiento.
import { parseInput } from './validation.js';
import { availabilityWindowsBody, toMinutes } from './schemas/staff.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// RF-2: la base guarda HH:MM:SS; la API expone HH:MM.
export const formatTime = (time) => time.slice(0, 5);

// Devuelve el horario validado y ordenado por día e inicio. Forma → 400, valores → 422.
export const normalizeWindows = (body) => {
  const windows = parseInput(availabilityWindowsBody, body)
    .map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time, start: toMinutes(start_time), end: toMinutes(end_time) }))
    .sort((a, b) => a.day_of_week - b.day_of_week || a.start - b.start);

  // RF-9: intervalos [inicio, fin). Ordenadas por día e inicio, basta comparar cada ventana con la anterior:
  // si todos los pares contiguos son disjuntos, ninguna ventana solapa con otra.
  for (let i = 1; i < windows.length; i++) {
    const prev = windows[i - 1];
    if (prev.day_of_week === windows[i].day_of_week && windows[i].start < prev.end) throw httpErr(422, 'overlapping_windows');
  }

  return windows.map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time }));
};
