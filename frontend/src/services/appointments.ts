import { api } from './api';
import type { Appointment } from '../domain/types';

export const appointmentsService = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return api.get<Appointment[]>(`/appointments${qs}`);
  },

  get: (id: string) => api.get<Appointment>(`/appointments/${id}`),

  cancel: (id: string) => api.patch(`/appointments/${id}/cancel`),

  correct: (id: string) => api.patch<Appointment>(`/appointments/${id}/correct`),
};
