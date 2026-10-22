import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PeriodPicker from './PeriodPicker';
import SummaryCards from './SummaryCards';
import PaymentsTable from './PaymentsTable';
import { localPeriod } from '../domain/day';
import { formatMoney } from '../domain/payments';
import type { Payment, PaymentsSummary } from '../domain/types';

test('PeriodPicker: los presets emiten el rango local — RF-20', async () => {
  const onChange = vi.fn();
  render(<PeriodPicker onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'Este mes' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Hoy' }));
  expect(onChange).toHaveBeenLastCalledWith(localPeriod('hoy', new Date()));
  await userEvent.click(screen.getByRole('button', { name: 'Esta semana' }));
  expect(onChange).toHaveBeenLastCalledWith(localPeriod('esta_semana', new Date()));
});

test('PeriodPicker: rango libre válido emite; desde > hasta se marca y no emite', async () => {
  const onChange = vi.fn();
  render(<PeriodPicker onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Rango' }));
  onChange.mockClear();
  const from = screen.getByLabelText('Desde');
  const to = screen.getByLabelText('Hasta');
  await userEvent.clear(from); await userEvent.type(from, '2026-05-10');
  await userEvent.clear(to); await userEvent.type(to, '2026-05-01');
  expect(screen.getByRole('alert')).toHaveTextContent(/anterior o igual/);
  expect(from).toHaveAttribute('aria-invalid', 'true');
  const calls = onChange.mock.calls.length;
  await userEvent.clear(to); await userEvent.type(to, '2026-05-12');
  expect(onChange.mock.calls.length).toBeGreaterThan(calls);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

const summary: PaymentsSummary = {
  totalAmount: 20000, employeeAmount: 8000, businessAmount: 12000, paymentCount: 3,
  byEmployee: [{ employeeId: 'u1', employeeName: 'Ana', totalAmount: 20000, employeeAmount: 8000, businessAmount: 12000 }],
};

test('SummaryCards owner: total, negocio, trabajadores y desglose — RF-21, RF-22', () => {
  render(<SummaryCards summary={summary} role="owner" />);
  expect(screen.getByText('Total cobrado')).toBeInTheDocument();
  expect(screen.getByText(formatMoney(20000))).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Por profesional' })).toBeInTheDocument();
  expect(screen.getByText('Ana')).toBeInTheDocument();
});

test('SummaryCards staff: solo su parte y sin desglose — RF-21', () => {
  render(<SummaryCards summary={{ ...summary, byEmployee: undefined }} role="staff" />);
  expect(screen.getByText('Tu parte')).toBeInTheDocument();
  expect(screen.queryByText('Total cobrado')).not.toBeInTheDocument();
  expect(screen.queryByText('Por profesional')).not.toBeInTheDocument();
});

const pay = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', appointmentId: 'a1', scheduledAt: new Date(2026, 4, 14, 15, 0).toISOString(), employeeId: 'u1', employeeName: 'Ana',
  clientName: 'Luz', serviceName: 'Corte', amount: '8000.00', employeeAmount: '3200.00', businessAmount: '4800.00', ...over,
});

test('PaymentsTable: columnas con encabezados y montos en CLP — RF-23, RF-26', () => {
  render(<MemoryRouter><PaymentsTable payments={[pay()]} role="owner" /></MemoryRouter>);
  expect(screen.getByRole('table', { name: 'Detalle de pagos del período' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Profesional' })).toBeInTheDocument();
  expect(screen.getByText('Luz')).toBeInTheDocument();
  expect(screen.getByText(formatMoney(3200))).toBeInTheDocument();
});

test('PaymentsTable: "Sin comisión definida" con enlace a Equipo para el owner — RF-24', () => {
  render(<MemoryRouter><PaymentsTable payments={[pay({ employeeAmount: null, businessAmount: null })]} role="owner" /></MemoryRouter>);
  expect(screen.getByText(/Sin comisión definida/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Equipo/ })).toHaveAttribute('href', '/owner/equipo');
});

test('PaymentsTable staff: sin columna de profesional ni enlace a Equipo', () => {
  render(<MemoryRouter><PaymentsTable payments={[pay({ employeeAmount: null, businessAmount: null })]} role="staff" /></MemoryRouter>);
  expect(screen.queryByRole('columnheader', { name: 'Profesional' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
