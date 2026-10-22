import { formatTime, statusLabel } from '../domain/format';
import type { AppointmentAction } from '../domain/appointmentActions';
import type { Appointment, Role } from '../domain/types';

const ACTION_LABEL: Record<AppointmentAction, string> = {
  edit: 'Editar',
  cancel: 'Cancelar turno',
  markNoShow: 'Marcar como no llegó',
  markCompleted: 'Marcar como completado',
  cancelBlock: 'Quitar bloqueo',
};

interface Props {
  appointment: Appointment;
  role: Role;
  actions: AppointmentAction[];
  onAction: (action: AppointmentAction, appointment: Appointment) => void;
}

// spec 010 RF-3, RF-13..RF-19 — una fila de la agenda: horas en 24 h, estado con texto (no solo color) y solo
// los botones que `availableActions` permite.
export default function AppointmentCard({ appointment: a, role, actions, onAction }: Props) {
  const isBlock = a.status === 'bloqueado';
  const who = isBlock ? 'bloqueo' : (a.client?.name ?? 'turno');
  const start = formatTime(a.scheduled_at);

  return (
    <article className={`apt apt--${a.status}`}>
      <div className="apt-time">
        <span>{start}</span>
        <span>{formatTime(a.scheduled_until)}</span>
      </div>
      <div className="apt-body">
        <strong>{isBlock ? 'Bloqueo' : (a.client?.name ?? '—')}</strong>
        {isBlock ? (a.notes && <span>{a.notes}</span>) : <span>{a.service?.name ?? '—'}</span>}
        {role === 'owner' && (
          <span className="apt-staff">{a.assignedUser?.name ?? (isBlock ? 'Todo el negocio' : '—')}</span>
        )}
      </div>
      <span className="apt-badge">{statusLabel(a.status)}</span>
      {actions.length > 0 && (
        <div className="apt-actions">
          {actions.map(action => (
            <button
              key={action}
              type="button"
              aria-label={`${ACTION_LABEL[action]} (${who}, ${start})`}
              onClick={() => onAction(action, a)}
            >
              {ACTION_LABEL[action]}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
