import { useCallback, useEffect, useState } from 'react';
import AppNav from '../components/AppNav';
import AppointmentCard from '../components/AppointmentCard';
import AppointmentForm from '../components/AppointmentForm';
import BlockForm from '../components/BlockForm';
import ConfirmDialog from '../components/ConfirmDialog';
import ErrorNote from '../components/ErrorNote';
import { useAuth } from '../context/AuthContext';
import { appointmentsService } from '../services/appointments';
import { clientsService } from '../services/clients';
import { servicesService } from '../services/services';
import { staffService } from '../services/staff';
import { ApiError } from '../services/api';
import { availableActions, type AppointmentAction } from '../domain/appointmentActions';
import { localDayRange } from '../domain/day';
import { formatDayLong } from '../domain/format';
import type { Appointment, Client, Service, StaffMember } from '../domain/types';

const LIST_LIMIT = 500; // spec 001 RF-41

type Panel = { kind: 'new' } | { kind: 'block' } | { kind: 'edit'; appointment: Appointment } | null;
type Pending = { action: Extract<AppointmentAction, 'cancel' | 'cancelBlock' | 'markNoShow' | 'markCompleted'>; appointment: Appointment };

const CONFIRM: Record<Pending['action'], { title: string; confirm: string; body: string; done: string }> = {
  cancel: { title: '¿Cancelar este turno?', confirm: 'Cancelar turno', body: 'El horario quedará libre para otras reservas.', done: 'Turno cancelado.' },
  cancelBlock: { title: '¿Quitar este bloqueo?', confirm: 'Quitar bloqueo', body: 'El horario volverá a ofrecerse para reservar.', done: 'Bloqueo quitado.' },
  markNoShow: {
    title: '¿Marcar que el cliente no llegó?', confirm: 'Marcar como no llegó',
    body: 'El pago de este turno se elimina del resumen de pagos. Puedes deshacerlo hasta el final del día siguiente (hora UTC).',
    done: 'Turno marcado como no llegó. Su pago se eliminó.',
  },
  markCompleted: {
    title: '¿Marcar el turno como completado?', confirm: 'Marcar como completado',
    body: 'Se crea el pago de este turno. Puedes deshacerlo hasta el final del día siguiente (hora UTC).',
    done: 'Turno marcado como completado. Se creó su pago.',
  },
};

const errorCode = (err: unknown) => (err instanceof ApiError ? err.message : 'error_desconocido');

function fmtDate(d: Date) {
  return d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
}

// spec 010 RF-3..RF-19 — agenda del día: ver, crear, editar, cancelar, bloquear y marcar asistencia.
export default function DashboardPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'staff';
  const selfId = user?.id ?? '';

  const [date, setDate] = useState(new Date());
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [staff, setStaff] = useState<StaffMember[]>([]);

  const [panel, setPanel] = useState<Panel>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [panelError, setPanelError] = useState<string | null>(null);

  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const refresh = useCallback(() => setReload(n => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    const { from, to } = localDayRange(date);
    const params: Record<string, string> = { date_from: from, date_to: to };
    if (role === 'owner' && employeeFilter) params.employee_id = employeeFilter; // RF-4
    appointmentsService.list(params)
      .then(list => { if (alive) setItems([...list].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))); })
      .catch(err => { if (alive) setLoadError(errorCode(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [date, employeeFilter, role, reload]);

  useEffect(() => {
    if (role !== 'owner') return;
    staffService.list('activo').then(setStaff).catch(() => {});
  }, [role]);

  function shift(days: number) {
    setDate(d => { const n = new Date(d); n.setDate(n.getDate() + days); return n; });
  }

  async function openPanel(next: NonNullable<Panel>) {
    setNotice(null);
    setActionError(null);
    setPanelError(null);
    setPanel(next);
    if (next.kind === 'block') return;
    try {
      const [s, c] = await Promise.all([servicesService.list(true), clientsService.list()]);
      setServices(s);
      setClients(c);
    } catch (err) {
      setPanelError(errorCode(err));
    }
  }

  async function handleCreate(body: Record<string, unknown>) {
    const { appointment } = await appointmentsService.create(body);
    setPanel(null);
    const when = new Date(appointment.scheduled_at);
    const sameDay = when.toDateString() === date.toDateString();
    const parts = [appointment.status === 'completado'
      ? 'Quedó registrado como completado y generó su pago.'
      : 'Turno creado.'];
    if (!sameDay) parts.push(`Quedó el ${formatDayLong(appointment.scheduled_at)}: cambia de día para verlo.`);
    setNotice(parts.join(' '));
    refresh();
  }

  async function handleBlock(body: Record<string, unknown>) {
    const block = await appointmentsService.block(body);
    setPanel(null);
    setNotice(new Date(block.scheduled_at).toDateString() === date.toDateString()
      ? 'Horario bloqueado.'
      : `Horario bloqueado el ${formatDayLong(block.scheduled_at)}: cambia de día para verlo.`);
    refresh();
  }

  async function handleEdit(appointment: Appointment, body: Record<string, unknown>) {
    await appointmentsService.edit(appointment.id, body);
    setPanel(null);
    setNotice('Turno actualizado.');
    refresh(); // la API devuelve la fila sin cliente ni servicio: se recarga el día para mostrarlos
  }

  function handleAction(action: AppointmentAction, appointment: Appointment) {
    setNotice(null);
    setActionError(null);
    if (action === 'edit') void openPanel({ kind: 'edit', appointment });
    else setPending({ action, appointment });
  }

  async function runPending() {
    if (!pending) return;
    const { action, appointment } = pending;
    setPending(null);
    try {
      const call = { cancel: appointmentsService.cancel, cancelBlock: appointmentsService.cancelBlock, markNoShow: appointmentsService.correct, markCompleted: appointmentsService.correct }[action];
      const updated = await call(appointment.id);
      // La respuesta no trae cliente ni servicio: se conserva lo que la fila ya mostraba (R5).
      setItems(list => list.map(a => (a.id === appointment.id ? { ...a, ...updated } : a)));
      setNotice(CONFIRM[action].done);
    } catch (err) {
      setActionError(errorCode(err));
    }
  }

  const isToday = new Date().toDateString() === date.toDateString();
  const now = new Date();
  const actor = { id: selfId, role };

  return (
    <div className="dash">
      <AppNav />

      <div className="dash-nav">
        <button onClick={() => shift(-1)} aria-label="Día anterior">‹</button>
        <span className="dash-date">
          {fmtDate(date)}
          {isToday && <em> · Hoy</em>}
        </span>
        <button onClick={() => shift(1)} aria-label="Día siguiente">›</button>
        {!isToday && (
          <button className="dash-today" onClick={() => setDate(new Date())}>Hoy</button>
        )}
      </div>

      <div className="dash-tools pub-page">
        <button type="button" onClick={() => void openPanel({ kind: 'new' })}>Nuevo turno</button>
        <button type="button" className="pub-secondary" onClick={() => void openPanel({ kind: 'block' })}>Bloquear horario</button>
        {role === 'owner' && (
          <label className="mgmt-filter">Profesional
            <select value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}>
              <option value="">Todos</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {notice && <p role="status" className="pub-success">{notice}</p>}
      <ErrorNote code={actionError} />

      {panel && (
        <section className="pub-page mgmt dash-panel">
          {panelError && <ErrorNote code={panelError} />}
          {panel.kind === 'block' && (
            <BlockForm role={role} staff={staff} day={date} onSubmit={handleBlock} onCancel={() => setPanel(null)} />
          )}
          {panel.kind === 'new' && (
            <AppointmentForm
              role={role} selfId={selfId} services={services} clients={clients} staff={staff} day={date}
              loadAvailability={staffService.getAvailability}
              onSubmit={handleCreate} onCancel={() => setPanel(null)}
            />
          )}
          {panel.kind === 'edit' && (
            <AppointmentForm
              role={role} selfId={selfId} services={services} clients={clients} staff={staff} day={date}
              editing={panel.appointment}
              onSubmit={body => handleEdit(panel.appointment, body)} onCancel={() => setPanel(null)}
            />
          )}
        </section>
      )}

      <main className="dash-list">
        {loading && <p className="dash-empty">Cargando...</p>}
        {loadError && <ErrorNote code={loadError} />}
        {!loading && !loadError && items.length === 0 && (
          <div className="dash-empty">
            <p>No hay turnos para este día</p>
            <button type="button" className="dash-link" onClick={() => void openPanel({ kind: 'new' })}>Nuevo turno</button>
          </div>
        )}
        {items.length >= LIST_LIMIT && (
          <p role="status" className="pub-warning">Se muestran los primeros {LIST_LIMIT} turnos: puede haber más. Filtra por profesional para verlos.</p>
        )}
        {items.map(a => (
          <AppointmentCard key={a.id} appointment={a} role={role} actions={availableActions(a, actor, now)} onAction={handleAction} />
        ))}
      </main>

      {pending && (
        <ConfirmDialog
          title={CONFIRM[pending.action].title}
          confirmLabel={CONFIRM[pending.action].confirm}
          onConfirm={() => void runPending()}
          onCancel={() => setPending(null)}
        >
          <p>{CONFIRM[pending.action].body}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
