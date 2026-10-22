import type { Slot } from './publicTypes';

export const DEFAULT_DAYS = 14;

export interface DaySlots {
  day: string; // YYYY-MM-DD en hora local
  date: Date;  // 00:00 local de ese día
  slots: Slot[];
  empty: boolean;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const dayKey = (d: Date) => {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

// RF-16: con "Cualquiera" varios profesionales pueden tener libre el mismo horario; se muestra una sola vez.
export function dedupeByStart(slots: Slot[]): Slot[] {
  const seen = new Set<string>();
  const unique: Slot[] = [];
  for (const slot of [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    if (seen.has(slot.starts_at)) continue;
    seen.add(slot.starts_at);
    unique.push(slot);
  }
  return unique;
}

// RF-15 / D-P8: una sola consulta cubre `days` días desde las 00:00 locales de `from`.
export function rangeFor(from: Date, days = DEFAULT_DAYS): { date_from: string; date_to: string } {
  const start = startOfDay(from);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days);
  return { date_from: start.toISOString(), date_to: end.toISOString() };
}

// RF-15: un grupo por día de la ventana (aunque no tenga horarios), agrupado por día local.
export function groupByDay(slots: Slot[], days: number, from: Date): DaySlots[] {
  const start = startOfDay(from);
  const groups: DaySlots[] = Array.from({ length: days }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { day: dayKey(date), date, slots: [], empty: true };
  });
  const byDay = new Map(groups.map(g => [g.day, g]));

  for (const slot of [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const group = byDay.get(dayKey(new Date(slot.starts_at)));
    if (!group) continue;
    group.slots.push(slot);
    group.empty = false;
  }
  return groups;
}
