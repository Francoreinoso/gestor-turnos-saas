import { api } from './api';
import type { StaffMember, StaffStatus, InvitationResult } from '../domain/types';
import type { Window } from '../domain/schedule';

// spec 009 — trabajadores, su horario semanal y el perfil propio.
export const staffService = {
  list: (status?: StaffStatus) =>
    api.get<{ staff: StaffMember[] }>(`/staff${status ? `?status=${status}` : ''}`).then(r => r.staff),

  get: (id: string) => api.get<{ user: StaffMember }>(`/staff/${id}`).then(r => r.user),

  invite: (body: { name: string; email: string; commission_rate?: number }) =>
    api.post<InvitationResult>('/staff', body),

  // commission_rate: null = la comisión de la cuenta (spec 002 RF-19).
  edit: (id: string, body: { name?: string; email?: string; commission_rate?: number | null }) =>
    api.patch<{ user: StaffMember }>(`/staff/${id}`, body).then(r => r.user),

  resendInvitation: (id: string) => api.patch<InvitationResult>(`/staff/${id}/resend-invitation`),

  deactivate: (id: string) => api.patch<{ user: StaffMember }>(`/staff/${id}/deactivate`).then(r => r.user),

  getAvailability: (id: string) => api.get<Window[]>(`/staff/${id}/availability`),

  // Reemplazo total del horario (spec 004): el cuerpo es el estado final.
  replaceAvailability: (id: string, windows: Window[]) => api.put<Window[]>(`/staff/${id}/availability`, windows),

  editMe: (body: { name?: string; password?: string }) =>
    api.patch<{ user: StaffMember }>('/me', body).then(r => r.user),
};
