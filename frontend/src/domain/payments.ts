import { formatPrice } from './format';
import type { Payment, PaymentsSummary, Role } from './types';

// spec 010 RF-21..RF-24 — presentación de pagos. La API cuenta en pesos con decimales; la pantalla, en CLP sin ellos.

export const formatMoney = (amount: number | string) => formatPrice(String(amount));

export const NO_COMMISSION = 'Sin comisión definida';

export interface PaymentRow {
  id: string;
  date: string;
  client: string;
  service: string;
  employee: string;
  amount: string;
  employeeAmount: string | null; // null = sin comisión (RF-24)
  businessAmount: string | null;
  missingCommission: boolean;
}

export function paymentRow(payment: Payment): PaymentRow {
  const missingCommission = payment.employeeAmount === null;
  return {
    id: payment.id,
    date: payment.scheduledAt,
    client: payment.clientName ?? '—',
    service: payment.serviceName ?? '—',
    employee: payment.employeeName ?? '—',
    amount: formatMoney(payment.amount),
    employeeAmount: missingCommission ? null : formatMoney(payment.employeeAmount as string),
    businessAmount: payment.businessAmount === null ? null : formatMoney(payment.businessAmount),
    missingCommission,
  };
}

export interface SummaryCard {
  key: 'total' | 'business' | 'employees' | 'count';
  label: string;
  value: string;
}

// RF-21: el owner ve total, negocio, trabajadores y cantidad; el staff, solo su parte y la cantidad.
export function summaryCards(summary: PaymentsSummary, role: Role): SummaryCard[] {
  const count: SummaryCard = { key: 'count', label: 'Pagos', value: String(summary.paymentCount) };
  if (role === 'staff') return [{ key: 'employees', label: 'Tu parte', value: formatMoney(summary.employeeAmount) }, count];
  return [
    { key: 'total', label: 'Total cobrado', value: formatMoney(summary.totalAmount) },
    { key: 'business', label: 'Parte del negocio', value: formatMoney(summary.businessAmount) },
    { key: 'employees', label: 'Parte de los trabajadores', value: formatMoney(summary.employeeAmount) },
    count,
  ];
}
