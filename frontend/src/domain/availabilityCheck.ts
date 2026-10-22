import type { Window } from './schedule';

// spec 010 RF-12 — advertencia (no bloqueante) cuando un turno cae fuera del horario semanal del profesional.
// Se evalúa en la hora local del navegador, el mismo reloj con que se escribe el formulario.

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function isWithinSchedule(start: Date, end: Date, windows: Window[]): boolean {
  const sameDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
  if (!sameDay) return false;

  const from = start.getHours() * 60 + start.getMinutes();
  const to = end.getHours() * 60 + end.getMinutes();

  // Se unen los tramos contiguos o solapados del día para que un turno pueda cruzar de uno a otro.
  const spans = windows
    .filter(w => w.day_of_week === start.getDay())
    .map(w => [minutes(w.start_time), minutes(w.end_time)] as const)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged.some(([s, e]) => from >= s && to <= e);
}
