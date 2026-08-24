import { api } from './api';
import type { Appointment } from '../domain/types';

export const appointmentsService = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return api.get<Appointment[]>(`/appointments${qs}`);
  },

  get: (id: string) => api.get<Appointment>(`/appointments/${id}`),

  create: (body: {
    account_id: string;
    service_id: string;
    scheduled_at: string;
    client_id?: string;
    employee_id?: string;
    notes?: string;
  }) => api.post<{ appointment: Appointment; access_token: string }>('/appointments', body),

  cancel: (id: string) => api.patch(`/appointments/${id}/cancel`),

  correct: (id: string) => api.patch<Appointment>(`/appointments/${id}/correct`),
};
