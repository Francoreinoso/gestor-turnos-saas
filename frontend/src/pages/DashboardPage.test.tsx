import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import DashboardPage from './DashboardPage';
import { appointmentsService } from '../services/appointments';

vi.mock('../services/appointments', () => ({ appointmentsService: { list: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem('token', `h.${btoa(JSON.stringify({ id: 'o1', account_id: 'acc-1', role: 'owner' }))}.s`);
});

test('RF-26: las horas de la agenda se muestran en 24 h (HH:mm) y el encabezado trae la navegación del panel', async () => {
  const start = new Date(); start.setHours(15, 5, 0, 0);
  const end = new Date(); end.setHours(15, 35, 0, 0);
  vi.mocked(appointmentsService.list).mockResolvedValue([{
    id: 'a1', account_id: 'acc-1', client_id: 'c1', service_id: 's1', assigned_user_id: 'u1',
    scheduled_at: start.toISOString(), scheduled_until: end.toISOString(), status: 'agendado', notes: null,
    client: { id: 'c1', name: 'Luz', email: null, phone: null },
  }]);

  render(<AuthProvider><MemoryRouter><DashboardPage /></MemoryRouter></AuthProvider>);

  expect(await screen.findByText('15:05')).toBeInTheDocument();
  expect(screen.getByText('15:35')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Servicios' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument();
});
