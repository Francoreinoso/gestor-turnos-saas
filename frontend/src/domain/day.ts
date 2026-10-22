// spec 010 RF-3, RF-20 — días y períodos en la hora local del navegador (D2: viajan como rango libre).

export interface IsoRange {
  from: string;
  to: string;
}

export type PeriodPreset = 'hoy' | 'esta_semana' | 'este_mes';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const toRange = (from: Date, to: Date): IsoRange => ({ from: startOfDay(from).toISOString(), to: endOfDay(to).toISOString() });

export const localDayRange = (day: Date): IsoRange => toRange(day, day);

export function localPeriod(preset: PeriodPreset, now: Date): IsoRange {
  if (preset === 'hoy') return localDayRange(now);
  if (preset === 'esta_semana') {
    const sinceMonday = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday);
    const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday + 6);
    return toRange(monday, sunday);
  }
  return toRange(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

const parseDateInput = (value: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

// Rango libre desde dos <input type="date">. null si falta una fecha o "desde" es posterior a "hasta".
export function localRange(fromValue: string, toValue: string): IsoRange | null {
  const from = parseDateInput(fromValue);
  const to = parseDateInput(toValue);
  if (!from || !to || from.getTime() > to.getTime()) return null;
  return toRange(from, to);
}

const pad = (n: number) => String(n).padStart(2, '0');

export const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
