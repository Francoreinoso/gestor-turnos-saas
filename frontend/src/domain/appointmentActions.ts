import type { Appointment, Role } from './types';

// spec 010 RF-13, RF-15, RF-17, RF-19 — qué botones ofrece cada fila de la agenda.
export type AppointmentAction = 'cancel' | 'edit' | 'markNoShow' | 'markCompleted' | 'cancelBlock';

export interface Actor {
  id: string;
  role: Role;
}

// Réplica de assertCorrectionWindow del backend (que es la autoridad, R2): hasta 23:59:59.999 UTC del día siguiente.
export function isCorrectable(scheduledAt: string, now: Date): boolean {
  const start = new Date(scheduledAt);
  const windowEnd = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1, 23, 59, 59, 999);
  return now.getTime() <= windowEnd;
}

export function availableActions(appointment: Appointment, actor: Actor, now: Date): AppointmentAction[] {
  if (actor.role === 'staff' && appointment.assigned_user_id !== actor.id) return [];
  switch (appointment.status) {
    case 'agendado':
      return ['edit', 'cancel'];
    case 'bloqueado':
      return ['cancelBlock'];
    case 'completado':
      return isCorrectable(appointment.scheduled_at, now) ? ['markNoShow'] : [];
    case 'no_llego':
      return isCorrectable(appointment.scheduled_at, now) ? ['markCompleted'] : [];
    default:
      return [];
  }
}
