import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { appointmentsService } from '../services/appointments';
import type { Appointment, AppointmentStatus } from '../domain/types';

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  bloqueado:   'Bloqueado',
  agendado:    'Agendado',
  en_progreso: 'En progreso',
  completado:  'Completado',
  no_llego:    'No llegó',
  cancelado:   'Cancelado',
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario',
  staff: 'Staff',
};

function toDateRange(d: Date) {
  const from = new Date(d); from.setHours(0, 0, 0, 0);
  const to   = new Date(d); to.setHours(23, 59, 59, 999);
  return { date_from: from.toISOString(), date_to: to.toISOString() };
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [date, setDate]       = useState(new Date());
  const [items, setItems]     = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    appointmentsService.list(toDateRange(date))
      .then(setItems)
      .finally(() => setLoading(false));
  }, [date]);

  function shift(days: number) {
    setDate(d => { const n = new Date(d); n.setDate(n.getDate() + days); return n; });
  }

  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <div className="dash">
      <header className="dash-header">
        <span className="dash-role">{user ? ROLE_LABEL[user.role] : ''}</span>
        <button onClick={logout} className="dash-logout">Salir</button>
      </header>

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

      <main className="dash-list">
        {loading && <p className="dash-empty">Cargando...</p>}
        {!loading && items.length === 0 && (
          <p className="dash-empty">Sin turnos para este día.</p>
        )}
        {items.map(a => (
          <article key={a.id} className={`apt apt--${a.status}`}>
            <div className="apt-time">
              <span>{fmtTime(a.scheduled_at)}</span>
              <span>{fmtTime(a.scheduled_until)}</span>
            </div>
            <div className="apt-body">
              <strong>{a.client?.name ?? '—'}</strong>
              <span>{a.service?.name ?? '—'}</span>
              {a.assignedUser && <span className="apt-staff">{a.assignedUser.name}</span>}
            </div>
            <span className="apt-badge">{STATUS_LABEL[a.status]}</span>
          </article>
        ))}
      </main>
    </div>
  );
}
