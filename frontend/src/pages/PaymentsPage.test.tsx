import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import PaymentsPage from './PaymentsPage';
import { paymentsService } from '../services/payments';
import { staffService } from '../services/staff';
import { ApiError } from '../services/api';
import { localPeriod } from '../domain/day';
import { formatMoney } from '../domain/payments';
import type { Payment } from '../domain/types';

vi.mock('../services/payments', () => ({ paymentsService: { summary: vi.fn(), list: vi.fn() } }));
vi.mock('../services/staff', () => ({ staffService: { list: vi.fn() } }));

const login = (role: 'owner' | 'staff') =>
  localStorage.setItem('token', `h.${btoa(JSON.stringify({ id: 'x1', account_id: 'acc-1', role }))}.s`);

const pay = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', appointmentId: 'a1', scheduledAt: new Date(2026, 4, 14, 15, 0).toISOString(), employeeId: 'u1', employeeName: 'Ana',
  clientName: 'Luz', serviceName: 'Corte', amount: '8000.00', employeeAmount: '3200.00', businessAmount: '4800.00', ...over,
});

const summary = {
  totalAmount: 8000, employeeAmount: 3200, businessAmount: 4800, paymentCount: 1,
  byEmployee: [{ employeeId: 'u1', employeeName: 'Ana', totalAmount: 8000, employeeAmount: 3200, businessAmount: 4800 }],
};

const renderPage = () => render(<AuthProvider><MemoryRouter><PaymentsPage /></MemoryRouter></AuthProvider>);

beforeEach(() => {
  vi.resetAllMocks();
  login('owner');
  vi.mocked(paymentsService.summary).mockResolvedValue(summary);
  vi.mocked(paymentsService.list).mockResolvedValue({ payments: [pay()], hasMore: false });
  vi.mocked(staffService.list).mockResolvedValue([{ id: 'u1', account_id: 'acc-1', name: 'Ana', email: 'a@x.cl', role: 'staff', status: 'activo', commission_rate: null }]);
});

test('RF-20: carga "Este mes" con el rango local y las dos consultas en paralelo', async () => {
  renderPage();
  await screen.findByText('Total cobrado');
  const expected = localPeriod('este_mes', new Date());
  expect(paymentsService.summary).toHaveBeenCalledWith(expected);
  expect(paymentsService.list).toHaveBeenCalledWith(expected);
  expect(screen.getByRole('button', { name: 'Este mes' })).toHaveAttribute('aria-pressed', 'true');
});

test('RF-20: cambiar el período recarga', async () => {
  renderPage();
  await screen.findByText('Total cobrado');
  await userEvent.click(screen.getByRole('button', { name: 'Hoy' }));
  await waitFor(() => expect(paymentsService.summary).toHaveBeenLastCalledWith(localPeriod('hoy', new Date())));
  expect(paymentsService.list).toHaveBeenLastCalledWith(localPeriod('hoy', new Date()));
});

test('RF-21..RF-23: el owner ve tarjetas, desglose por profesional y detalle', async () => {
  renderPage();
  expect(await screen.findByText('Total cobrado')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Por profesional' })).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getAllByText(formatMoney(8000)).length).toBeGreaterThan(0);
});

test('RF-22: el filtro por profesional envía employeeId', async () => {
  renderPage();
  await userEvent.selectOptions(await screen.findByLabelText('Profesional'), 'u1');
  await waitFor(() => expect(paymentsService.summary).toHaveBeenLastCalledWith(expect.objectContaining({ employeeId: 'u1' })));
});

test('RF-21: el staff ve solo su parte, sin desglose ni filtro', async () => {
  login('staff');
  vi.mocked(paymentsService.summary).mockResolvedValue({ totalAmount: 8000, employeeAmount: 3200, businessAmount: 4800, paymentCount: 1 });
  renderPage();
  expect(await screen.findByText('Tu parte')).toBeInTheDocument();
  expect(screen.queryByText('Total cobrado')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Por profesional' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Profesional')).not.toBeInTheDocument();
  expect(staffService.list).not.toHaveBeenCalled();
  expect(screen.queryByRole('columnheader', { name: 'Profesional' })).not.toBeInTheDocument();
});

test('RF-23: hasMore avisa que se muestran los primeros 500', async () => {
  vi.mocked(paymentsService.list).mockResolvedValue({ payments: [pay()], hasMore: true });
  renderPage();
  expect(await screen.findByText(/primeros 500 pagos/)).toBeInTheDocument();
});

test('sin pagos en el período lo dice', async () => {
  vi.mocked(paymentsService.list).mockResolvedValue({ payments: [], hasMore: false });
  renderPage();
  expect(await screen.findByText('No hay pagos en este período.')).toBeInTheDocument();
});

test('un error de la API se muestra en español', async () => {
  vi.mocked(paymentsService.summary).mockRejectedValue(new ApiError(400, 'invalid_period'));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent(/período elegido no es válido/);
});

test('RF-25: no hay controles de escritura', async () => {
  renderPage();
  await screen.findByText('Total cobrado');
  expect(screen.queryByRole('button', { name: /eliminar|borrar|editar|agregar|crear/i })).not.toBeInTheDocument();
});
