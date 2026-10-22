import { useState } from 'react';
import ErrorNote from './ErrorNote';
import { ApiError } from '../services/api';
import { FORM_ERROR_TEXT, buildBlock, validateBlock, type BlockFormValues } from '../domain/appointmentForm';
import { toDateInput } from '../domain/day';
import type { Role, StaffMember } from '../domain/types';

interface Props {
  role: Role;
  staff: StaffMember[];
  day: Date;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

// spec 010 RF-14, RF-16 — bloquear un tramo de la agenda. El owner elige "Todo el negocio" o un profesional; el staff, el suyo.
export default function BlockForm({ role, staff, day, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<BlockFormValues>({ date: toDateInput(day), from: '14:00', to: '18:00', assignedUserId: '', notes: '' });
  const [error, setError] = useState<{ code?: string; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof BlockFormValues>(key: K, value: BlockFormValues[K]) => setForm(f => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = validateBlock(form);
    if (problem) return setError({ message: FORM_ERROR_TEXT[problem] }); // RF-16: antes de enviar
    setBusy(true);
    try {
      await onSubmit(buildBlock(form, role));
    } catch (err) {
      setError({ code: err instanceof ApiError ? err.message : 'error_desconocido' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pub-form" onSubmit={handleSubmit} noValidate aria-label="Bloquear horario">
      <h2>Bloquear horario</h2>
      {role === 'owner' && (
        <label>Aplica a
          <select value={form.assignedUserId} onChange={e => set('assignedUserId', e.target.value)}>
            <option value="">Todo el negocio</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <label>Fecha
        <input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
      </label>
      <label>Desde
        <input type="time" value={form.from} onChange={e => set('from', e.target.value)} />
      </label>
      <label>Hasta
        <input type="time" value={form.to} onChange={e => set('to', e.target.value)} />
      </label>
      <label>Nota (opcional)
        <input value={form.notes} onChange={e => set('notes', e.target.value)} />
      </label>
      <ErrorNote code={error?.code} message={error?.message} />
      <div className="pub-actions">
        <button type="submit" disabled={busy}>Bloquear</button>
        <button type="button" className="pub-secondary" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
