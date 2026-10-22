import { api } from './api';
import type { Payment, PaymentsPage, PaymentsSummary } from '../domain/types';

// spec 010 RF-20..RF-23 — el período viaja como rango libre calculado en el navegador (D2).
export interface PaymentsQuery {
  from: string;
  to: string;
  employeeId?: string;
}

const qs = ({ from, to, employeeId }: PaymentsQuery) => {
  const params = new URLSearchParams({ date_from: from, date_to: to });
  if (employeeId) params.set('employee_id', employeeId);
  return '?' + params.toString();
};

export const paymentsService = {
  summary: (query: PaymentsQuery) => api.get<PaymentsSummary>(`/payments/summary${qs(query)}`),

  list: (query: PaymentsQuery) => api.get<{ payments: Payment[]; hasMore: boolean }>(`/payments${qs(query)}`) as Promise<PaymentsPage>,
};
