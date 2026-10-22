import type { Role } from './types';

// spec 010 RF-7, RF-8, RF-11, RF-14, RF-16 — de lo escrito en los formularios al cuerpo que espera la API.
// Las fechas y horas se interpretan en la hora local del navegador.

export interface NewClient {
  name: string;
  email: string;
  phone: string;
}

export interface AppointmentFormValues {
  serviceId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  clientId: string; // '' = cliente nuevo
  newClient: NewClient;
  employeeId: string; // '' = asignar automáticamente
  notes: string;
}

export type AppointmentFormError = 'service_required' | 'datetime_required' | 'client_required' | 'client_incomplete';

export const FORM_ERROR_TEXT: Record<AppointmentFormError | BlockError, string> = {
  service_required: 'Elige un servicio.',
  datetime_required: 'Indica la fecha y la hora del turno.',
  client_required: 'Elige un cliente o ingresa uno nuevo.',
  client_incomplete: 'Para un cliente nuevo indica su nombre y al menos un email o un teléfono.',
  block_incomplete: 'Indica la fecha, la hora de inicio y la hora de fin.',
  end_not_after_start: 'La hora de fin debe ser posterior a la de inicio.',
};

export const toLocalIso = (date: string, time: string): string | null => {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const value = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
};

const clean = (s: string) => s.trim();

export function validateAppointmentForm(form: AppointmentFormValues): AppointmentFormError | null {
  if (!form.serviceId) return 'service_required';
  if (!toLocalIso(form.date, form.time)) return 'datetime_required';
  if (!form.clientId) {
    const c = form.newClient;
    if (!clean(c.name) && !clean(c.email) && !clean(c.phone)) return 'client_required';
    if (!clean(c.name) || (!clean(c.email) && !clean(c.phone))) return 'client_incomplete';
  }
  return null;
}

export function buildPanelAppointment(form: AppointmentFormValues, role: Role) {
  const body: Record<string, unknown> = {
    service_id: form.serviceId,
    scheduled_at: toLocalIso(form.date, form.time),
  };
  if (form.clientId) {
    body.client_id = form.clientId;
  } else {
    const c = form.newClient;
    body.client = {
      name: clean(c.name),
      ...(clean(c.email) ? { email: clean(c.email) } : {}),
      ...(clean(c.phone) ? { phone: clean(c.phone) } : {}),
    };
  }
  if (role === 'owner' && form.employeeId) body.employee_id = form.employeeId; // el staff nunca elige (RF-11)
  if (clean(form.notes)) body.notes = clean(form.notes);
  return body;
}

// RF-8: búsqueda por nombre, email o teléfono, sin distinguir mayúsculas ni tildes.
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function clientMatches(client: { name: string; email: string | null; phone: string | null }, query: string): boolean {
  const q = normalize(query.trim());
  if (!q) return true;
  return [client.name, client.email ?? '', client.phone ?? ''].some(field => normalize(field).includes(q));
}

export interface BlockFormValues {
  date: string;
  from: string; // HH:mm
  to: string;
  assignedUserId: string; // '' = todo el negocio (solo owner)
  notes: string;
}

export type BlockError = 'block_incomplete' | 'end_not_after_start';

export function validateBlock(form: Pick<BlockFormValues, 'date' | 'from' | 'to'>): BlockError | null {
  const start = toLocalIso(form.date, form.from);
  const end = toLocalIso(form.date, form.to);
  if (!start || !end) return 'block_incomplete';
  return new Date(end).getTime() > new Date(start).getTime() ? null : 'end_not_after_start';
}

export function buildBlock(form: BlockFormValues, role: Role) {
  const body: Record<string, unknown> = {
    scheduled_at: toLocalIso(form.date, form.from),
    scheduled_until: toLocalIso(form.date, form.to),
  };
  if (role === 'owner') body.assigned_user_id = form.assignedUserId || null; // el staff siempre bloquea lo suyo (RF-14)
  if (clean(form.notes)) body.notes = clean(form.notes);
  return body;
}
