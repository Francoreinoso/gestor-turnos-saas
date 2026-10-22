import { api } from './api';
import type { Appointment } from '../domain/types';

// spec 010 RF-7..RF-19 — operación de la agenda desde el panel.
export const appointmentsService = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return api.get<Appointment[]>(`/appointments${qs}`);
  },

  get: (id: string) => api.get<Appointment>(`/appointments/${id}`),

  // 201 → { appointment, access_token? }; si el turno nace `completado` no hay enlace (spec 001 RF-18).
  create: (body: Record<string, unknown>) =>
    api.post<{ appointment: Appointment; access_token?: string }>('/appointments', body),

  block: (body: Record<string, unknown>) => api.post<Appointment>('/appointments/block', body),

  edit: (id: string, body: { notes?: string | null; service_id?: string; client_id?: string; assigned_user_id?: string }) =>
    api.patch<Appointment>(`/appointments/${id}`, body),

  cancel: (id: string) => api.patch<Appointment>(`/appointments/${id}/cancel`),

  cancelBlock: (id: string) => api.patch<Appointment>(`/appointments/${id}/cancel-block`),

  correct: (id: string) => api.patch<Appointment>(`/appointments/${id}/correct`),
};
