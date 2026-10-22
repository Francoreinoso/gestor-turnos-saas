import { useState } from 'react';
import { localPeriod, localRange, toDateInput, type IsoRange, type PeriodPreset } from '../domain/day';

type Choice = PeriodPreset | 'rango';

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'esta_semana', label: 'Esta semana' },
  { value: 'este_mes', label: 'Este mes' },
  { value: 'rango', label: 'Rango' },
];

interface Props {
  initial?: Choice;
  onChange: (range: IsoRange) => void;
}

// spec 010 RF-20 — el período se calcula en el día local del navegador y se emite como rango.
export default function PeriodPicker({ initial = 'este_mes', onChange }: Props) {
  const [choice, setChoice] = useState<Choice>(initial);
  const [from, setFrom] = useState(() => toDateInput(new Date()));
  const [to, setTo] = useState(() => toDateInput(new Date()));

  function pick(next: Choice) {
    setChoice(next);
    if (next !== 'rango') onChange(localPeriod(next, new Date()));
    else { const r = localRange(from, to); if (r) onChange(r); }
  }

  function changeDates(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    const r = localRange(nextFrom, nextTo);
    if (r) onChange(r);
  }

  const invalid = choice === 'rango' && localRange(from, to) === null;

  return (
    <fieldset className="pub-radios period-picker">
      <legend>Período</legend>
      <div className="pub-actions">
        {CHOICES.map(c => (
          <button key={c.value} type="button" className="pub-chip" aria-pressed={choice === c.value} onClick={() => pick(c.value)}>{c.label}</button>
        ))}
      </div>
      {choice === 'rango' && (
        <div className="pub-form">
          <label>Desde
            <input type="date" value={from} aria-invalid={invalid} onChange={e => changeDates(e.target.value, to)} />
          </label>
          <label>Hasta
            <input type="date" value={to} aria-invalid={invalid} onChange={e => changeDates(from, e.target.value)} />
          </label>
          {invalid && <p role="alert" className="pub-error">La fecha inicial debe ser anterior o igual a la final.</p>}
        </div>
      )}
    </fieldset>
  );
}
