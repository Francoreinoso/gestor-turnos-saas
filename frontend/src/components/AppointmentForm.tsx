import { useEffect, useState } from 'react';
import ClientPicker from './ClientPicker';
import ErrorNote from './ErrorNote';
import { ApiError } from '../services/api';
import { isWithinSchedule } from '../domain/availabilityCheck';
import {
  FORM_ERROR_TEXT, buildPanelAppointment, toLocalIso, validateAppointmentForm, type AppointmentFormValues,
} from '../domain/appointmentForm';
import { toDateInput } from '../domain/day';
import type { Window } from '../domain/schedule';
import type { Appointment, Client, Role, Service, StaffMember } from '../domain/types';

interface Props {
  role: Role;
  selfId: string;
  services: Service[]; // solo activos (RF-7)
  clients: Client[];
  staff: StaffMember[]; // el owner elige entre ellos; el staff no ve el selector (RF-11)
  day: Date; // el día que muestra la agenda: valor por defecto de la fecha
  // Horario semanal de un trabajador, para la advertencia de RF-12. Si falla, no se advierte.
  loadAvailability?: (userId: string) => Promise<Window[]>;
  // Edición (RF-19): sin fecha ni hora. El cuerpo es solo lo que cambió.
  editing?: Appointment;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

const emptyClient = { name: '', email: '', phone: '' };

// spec 010 RF-7..RF-12, RF-19 — alta y edición de un turno desde el panel.
export default function AppointmentForm({ role, selfId, services, clients, staff, day, loadAvailability, editing, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<AppointmentFormValues>({
    serviceId: editing?.service_id ?? '',
    date: toDateInput(day),
    time: '10:00',
    clientId: editing?.client_id ?? '',
    newClient: emptyClient,
    employeeId: editing?.assigned_user_id ?? '',
    notes: editing?.notes ?? '',
  });
  const [error, setError] = useState<{ code?: string; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<{ userId: string; windows: Window[] } | null>(null);

  const set = <K extends keyof AppointmentFormValues>(key: K, value: AppointmentFormValues[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  // RF-12: el horario del profesional elegido (el staff, el suyo; el owner con "automático", ninguno).
  const checkedUserId = role === 'staff' ? selfId : form.employeeId;
  useEffect(() => {
    let alive = true;
    if (editing || !checkedUserId || !loadAvailability) return;
    loadAvailability(checkedUserId).then(w => { if (alive) setLoaded({ userId: checkedUserId, windows: w }); }).catch(() => {});
    return () => { alive = false; };
  }, [checkedUserId, loadAvailability, editing]);
  const windows = loaded && loaded.userId === checkedUserId ? loaded.windows : null; // un horario viejo no se aplica a otro profesional

  const service = services.find(s => s.id === form.serviceId);
  const startIso = toLocalIso(form.date, form.time);
  const outside = !editing && windows !== null && service && startIso
    ? !isWithinSchedule(new Date(startIso), new Date(new Date(startIso).getTime() + service.duration_minutes * 60000), windows)
    : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let body: Record<string, unknown>;
    if (editing) {
      if (!form.serviceId) return setError({ message: FORM_ERROR_TEXT.service_required });
      if (!form.clientId) return setError({ message: FORM_ERROR_TEXT.client_required });
      body = { service_id: form.serviceId, client_id: form.clientId, notes: form.notes.trim() || null };
      if (role === 'owner' && form.employeeId) body.assigned_user_id = form.employeeId;
    } else {
      const problem = validateAppointmentForm(form);
      if (problem) return setError({ message: FORM_ERROR_TEXT[problem] });
      body = buildPanelAppointment(form, role);
    }

    setBusy(true);
    try {
      await onSubmit(body);
    } catch (err) {
      setError({ code: err instanceof ApiError ? err.message : 'error_desconocido' }); // conserva lo escrito (RF-10)
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pub-form" onSubmit={handleSubmit} noValidate aria-label={editing ? 'Editar turno' : 'Nuevo turno'}>
      <h2>{editing ? 'Editar turno' : 'Nuevo turno'}</h2>

      <label>Servicio
        <select value={form.serviceId} onChange={e => set('serviceId', e.target.value)}>
          <option value="">Elige un servicio</option>
          {services.map(s => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min</option>)}
        </select>
      </label>

      {!editing && (
        <>
          <label>Fecha
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </label>
          <label>Hora
            <input type="time" value={form.time} onChange={e => set('time', e.target.value)} />
          </label>
        </>
      )}

      <ClientPicker
        clients={clients}
        value={{ clientId: form.clientId, newClient: form.newClient }}
        onChange={v => setForm(f => ({ ...f, clientId: v.clientId, newClient: v.newClient }))}
      />

      {role === 'owner' && (
        <label>Profesional
          <select value={form.employeeId} onChange={e => set('employeeId', e.target.value)}>
            {!editing && <option value="">Asignar automáticamente</option>}
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}

      <label>Notas (opcional)
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
      </label>

      {outside && (
        <p role="status" className="pub-warning">
          Ese horario queda fuera del horario semanal del profesional. Puedes guardarlo igual.
        </p>
      )}
      <ErrorNote code={error?.code} message={error?.message} />

      <div className="pub-actions">
        <button type="submit" disabled={busy}>{editing ? 'Guardar cambios' : 'Crear turno'}</button>
        <button type="button" className="pub-secondary" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
