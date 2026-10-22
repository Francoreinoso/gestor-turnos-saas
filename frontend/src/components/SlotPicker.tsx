import { useState } from 'react';
import type { DaySlots } from '../domain/slots';
import type { Slot } from '../domain/publicTypes';
import { formatDayShort, formatDayLong, formatTime } from '../domain/format';

interface Props {
  days: DaySlots[];
  selected?: string | null; // starts_at del slot elegido
  onSelect: (slot: Slot) => void;
}

// RF-15 / RF-17: tira de días (los vacíos deshabilitados) y los horarios del día elegido.
// La usan la reserva y la reprogramación.
export default function SlotPicker({ days, selected, onSelect }: Props) {
  const [chosenDay, setChosenDay] = useState<string | null>(null);

  if (days.every(d => d.empty)) {
    return <p className="pub-note">No hay horarios disponibles en los próximos {days.length} días.</p>;
  }

  const activeDay = days.find(d => d.day === chosenDay && !d.empty) ?? days.find(d => !d.empty)!;

  return (
    <div className="pub-slots">
      <div className="pub-days" role="group" aria-label="Día">
        {days.map(d => (
          <button
            key={d.day}
            type="button"
            className="pub-chip"
            disabled={d.empty}
            aria-pressed={d.day === activeDay.day}
            onClick={() => setChosenDay(d.day)}
          >
            {formatDayShort(d.date)}
          </button>
        ))}
      </div>

      <div className="pub-times" role="group" aria-label={`Horarios del ${formatDayLong(activeDay.slots[0].starts_at)}`}>
        {activeDay.slots.map(slot => (
          <button
            key={`${slot.employee_id}-${slot.starts_at}`}
            type="button"
            className="pub-chip"
            aria-pressed={slot.starts_at === selected}
            onClick={() => onSelect(slot)}
          >
            {formatTime(slot.starts_at)}
          </button>
        ))}
      </div>
    </div>
  );
}
