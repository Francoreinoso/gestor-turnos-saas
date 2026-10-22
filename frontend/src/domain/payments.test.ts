import { test, expect } from 'vitest';
import { paymentRow, summaryCards, formatMoney } from './payments';
import type { Payment, PaymentsSummary } from './types';

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', appointmentId: 'a1', scheduledAt: '2026-05-14T15:00:00Z', employeeId: 'u1', employeeName: 'Ana',
  clientName: 'Luz', serviceName: 'Corte', amount: '8000.00', employeeAmount: '3200.00', businessAmount: '4800.00', ...over,
});

const clp = (n: number) => formatMoney(n);

test('formatMoney da pesos sin decimales para números y textos', () => {
  expect(formatMoney('8000.00')).toBe(clp(8000));
  expect(formatMoney(8000)).toBe(formatMoney('8000'));
  expect(formatMoney(8000)).toMatch(/8\.000/);
});

test('paymentRow con comisión formatea los tres montos — RF-23', () => {
  expect(paymentRow(payment())).toMatchObject({
    client: 'Luz', service: 'Corte', employee: 'Ana', amount: clp(8000), employeeAmount: clp(3200), businessAmount: clp(4800), missingCommission: false,
  });
});

test('paymentRow sin comisión no inventa un 0: marca missingCommission — RF-24', () => {
  const row = paymentRow(payment({ employeeAmount: null, businessAmount: null }));
  expect(row.missingCommission).toBe(true);
  expect(row.employeeAmount).toBeNull();
  expect(row.businessAmount).toBeNull();
});

test('paymentRow tolera cliente o servicio ausentes', () => {
  expect(paymentRow(payment({ clientName: null, serviceName: null, employeeName: null }))).toMatchObject({ client: '—', service: '—', employee: '—' });
});

const summary: PaymentsSummary = { totalAmount: 20000, employeeAmount: 8000, businessAmount: 12000, paymentCount: 3 };

test('summaryCards del owner: total, negocio, trabajadores y cantidad — RF-21', () => {
  expect(summaryCards(summary, 'owner').map(c => c.key)).toEqual(['total', 'business', 'employees', 'count']);
  expect(summaryCards(summary, 'owner')[0].value).toBe(clp(20000));
});

test('summaryCards del staff no muestra el total del negocio — RF-21', () => {
  const cards = summaryCards(summary, 'staff');
  expect(cards.map(c => c.key)).toEqual(['employees', 'count']);
  expect(cards[0]).toMatchObject({ label: 'Tu parte', value: clp(8000) });
  expect(JSON.stringify(cards)).not.toContain(clp(20000));
  expect(JSON.stringify(cards)).not.toContain(clp(12000));
});
