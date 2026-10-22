import { apiPublic } from './api';
import type { PublicAccount, PublicAppointment, Slot, BookingResult } from '../domain/publicTypes';
import type { BookingPayload } from '../domain/booking';

// spec 005 RF-30: el token de gestión se recibe por argumento y viaja solo en la query de cada llamada;
// este módulo no lo guarda en ningún lado.
const withToken = (path: string, token: string) => `${path}?token=${encodeURIComponent(token)}`;

export const publicService = {
  getAccount: (accountId: string) => apiPublic.get<PublicAccount>(`/public/accounts/${accountId}`),

  getSlots: (accountId: string, q: { serviceId: string; employeeId?: string | null; dateFrom: string; dateTo: string }) => {
    const params = new URLSearchParams({ service_id: q.serviceId, date_from: q.dateFrom, date_to: q.dateTo });
    if (q.employeeId) params.set('employee_id', q.employeeId);
    return apiPublic.get<Slot[]>(`/availability/${accountId}?${params}`);
  },

  book: (payload: BookingPayload) => apiPublic.post<BookingResult>('/public/bookings', payload),

  getAppointment: (id: string, token: string) =>
    apiPublic.get<PublicAppointment>(withToken(`/public/appointments/${id}`, token)),

  cancel: (id: string, token: string) =>
    apiPublic.patch<{ message: string }>(withToken(`/public/appointments/${id}/cancel`, token)),

  reschedule: (id: string, token: string, body: { scheduled_at: string; employee_id?: string }) =>
    apiPublic.patch<BookingResult>(withToken(`/public/appointments/${id}/reschedule`, token), body),
};
