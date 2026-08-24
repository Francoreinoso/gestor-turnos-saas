import { api } from './api';
import type { Service } from '../domain/types';

export const servicesService = {
  list: (active?: boolean) => {
    const qs = active !== undefined ? `?active=${active}` : '';
    return api.get<Service[]>(`/services${qs}`);
  },

  get: (id: string) => api.get<Service>(`/services/${id}`),

  create: (body: { name: string; duration_minutes: number; price: string }) =>
    api.post<Service>('/services', body),

  update: (id: string, body: { name?: string; duration_minutes?: number }) =>
    api.patch<Service>(`/services/${id}`, body),

  changePrice: (id: string, price: string) =>
    api.patch<Service>(`/services/${id}/prices`, { price }),

  deactivate: (id: string) => api.patch<Service>(`/services/${id}/deactivate`),
};
