// spec 009 RF-15..RF-17, RF-19 — modelo del horario semanal en el navegador.
// La API usa day_of_week 0 = domingo; la pantalla muestra lunes primero. Esa conversión vive solo acá (R1).

export interface Window {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

// Un tramo dentro de un día. Mientras se edita, un input de hora puede quedar vacío ('').
export interface Span {
  start: string;
  end: string;
}

// Siete listas: índice 0 = lunes … 6 = domingo.
export type WeekDays = Span[][];

export type ScheduleError = 'incomplete' | 'start_not_before_end' | 'overlap';

export const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;

const toApiDay = (index: number) => (index + 1) % 7;
const toIndex = (apiDay: number) => (apiDay + 6) % 7;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const bySpanStart = (a: Span, b: Span) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end);

export const emptyWeek = (): WeekDays => Array.from({ length: 7 }, () => []);

export function groupByDay(windows: Window[]): WeekDays {
  const days = emptyWeek();
  for (const w of windows) days[toIndex(w.day_of_week)].push({ start: w.start_time, end: w.end_time });
  return days.map(spans => [...spans].sort(bySpanStart));
}

export function flattenSchedule(days: WeekDays): Window[] {
  return days.flatMap((spans, index) =>
    spans.map(s => ({ day_of_week: toApiDay(index), start_time: s.start, end_time: s.end })));
}

// Mismas reglas que domain/availabilityWindows.js del backend (D4): inicio < fin y, dentro de un día, sin solapes.
// Dos tramos contiguos (09:00–12:00 y 12:00–15:00) son válidos. Devuelve un error por día (el primero) o null.
export function validateSchedule(days: WeekDays): (ScheduleError | null)[] {
  return days.map(spans => {
    if (spans.some(s => !TIME.test(s.start) || !TIME.test(s.end))) return 'incomplete';
    if (spans.some(s => minutes(s.start) >= minutes(s.end))) return 'start_not_before_end';
    const sorted = [...spans].sort((a, b) => minutes(a.start) - minutes(b.start));
    for (let i = 1; i < sorted.length; i++) {
      if (minutes(sorted[i].start) < minutes(sorted[i - 1].end)) return 'overlap';
    }
    return null;
  });
}

export const hasErrors = (errors: (ScheduleError | null)[]) => errors.some(e => e !== null);

const signature = (days: WeekDays) => JSON.stringify(days.map(spans => [...spans].sort(bySpanStart)));

export const isDirty = (a: WeekDays, b: WeekDays) => signature(a) !== signature(b);

export const SCHEDULE_ERROR_TEXT: Record<ScheduleError, string> = {
  incomplete: 'Completa la hora de inicio y de fin de cada tramo.',
  start_not_before_end: 'La hora de inicio debe ser anterior a la de fin.',
  overlap: 'Hay tramos que se solapan. Ajusta las horas.',
};
