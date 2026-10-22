import { DAY_NAMES, SCHEDULE_ERROR_TEXT } from '../domain/schedule';
import type { ScheduleError, WeekDays } from '../domain/schedule';

interface Props {
  days: WeekDays;
  errors: (ScheduleError | null)[];
  onChange: (days: WeekDays) => void;
}

const DEFAULT_SPAN = { start: '09:00', end: '18:00' };

// spec 009 RF-15..RF-17 — siete filas (lunes a domingo) con tramos agregables y quitables. Controlado y sin lógica
// de validación: los errores por fila llegan de `domain/schedule.ts`.
export default function ScheduleEditor({ days, errors, onChange }: Props) {
  const update = (dayIndex: number, spans: WeekDays[number]) =>
    onChange(days.map((s, i) => (i === dayIndex ? spans : s)));

  return (
    <div className="mgmt-schedule">
      {DAY_NAMES.map((name, dayIndex) => {
        const spans = days[dayIndex];
        const error = errors[dayIndex];
        return (
          <section key={name} className="mgmt-day" aria-label={name}>
            <h3>{name}</h3>
            {spans.length === 0 && <p className="pub-note">Sin atención</p>}
            {spans.map((span, i) => {
              const tramo = i === 0 ? '' : `tramo ${i + 1} · `;
              return (
                <div key={i} className="mgmt-span">
                  <input
                    type="time"
                    aria-label={`${name} · ${tramo}desde`}
                    aria-invalid={error ? true : undefined}
                    value={span.start}
                    onChange={e => update(dayIndex, spans.map((s, j) => (j === i ? { ...s, start: e.target.value } : s)))}
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    type="time"
                    aria-label={`${name} · ${tramo}hasta`}
                    aria-invalid={error ? true : undefined}
                    value={span.end}
                    onChange={e => update(dayIndex, spans.map((s, j) => (j === i ? { ...s, end: e.target.value } : s)))}
                  />
                  <button type="button" className="pub-secondary" aria-label={`Quitar tramo ${i + 1} del ${name.toLowerCase()}`}
                    onClick={() => update(dayIndex, spans.filter((_, j) => j !== i))}>Quitar</button>
                </div>
              );
            })}
            {error && <p role="alert" className="pub-field-error">{SCHEDULE_ERROR_TEXT[error]}</p>}
            <button type="button" className="pub-secondary" aria-label={`Agregar tramo el ${name.toLowerCase()}`}
              onClick={() => update(dayIndex, [...spans, { ...DEFAULT_SPAN }])}>Agregar tramo</button>
          </section>
        );
      })}
    </div>
  );
}
