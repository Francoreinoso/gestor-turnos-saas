import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppointmentCard from './AppointmentCard';
import type { Appointment } from '../domain/types';

const at = (h: number, m = 0) => new Date(2026, 4, 14, h, m).toISOString();
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1', account_id: 'acc', client_id: 'c1', service_id: 's1', assigned_user_id: 'u1',
  scheduled_at: at(15, 5), scheduled_until: at(15, 35), status: 'agendado', notes: null,
  client: { id: 'c1', name: 'Luz', email: null, phone: null },
  service: { id: 's1', name: 'Corte', duration_minutes: 30, price: '8000' },
  assignedUser: { id: 'u1', name: 'Ana' }, ...over,
});

test('RF-3: hora 24 h, cliente, servicio y estado en texto', () => {
  render(<AppointmentCard appointment={appt()} role="staff" actions={[]} onAction={() => {}} />);
  expect(screen.getByText('15:05')).toBeInTheDocument();
  expect(screen.getByText('15:35')).toBeInTheDocument();
  expect(screen.getByText('Luz')).toBeInTheDocument();
  expect(screen.getByText('Corte')).toBeInTheDocument();
  expect(screen.getByText('Agendado')).toBeInTheDocument();
});

test('RF-3: el profesional se muestra solo al owner', () => {
  const { rerender } = render(<AppointmentCard appointment={appt()} role="owner" actions={[]} onAction={() => {}} />);
  expect(screen.getByText('Ana')).toBeInTheDocument();
  rerender(<AppointmentCard appointment={appt()} role="staff" actions={[]} onAction={() => {}} />);
  expect(screen.queryByText('Ana')).not.toBeInTheDocument();
});

test('RF-3: un bloqueo se distingue y no muestra cliente', () => {
  render(<AppointmentCard appointment={appt({ status: 'bloqueado', client_id: null, client: undefined, service: undefined, notes: 'Trámite', assigned_user_id: null, assignedUser: undefined })} role="owner" actions={['cancelBlock']} onAction={() => {}} />);
  expect(screen.getByText('Bloqueo')).toBeInTheDocument();
  expect(screen.getByText('Trámite')).toBeInTheDocument();
  expect(screen.getByText('Todo el negocio')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Quitar bloqueo/ })).toBeInTheDocument();
});

test('muestra exactamente los botones de las acciones y los dispara', async () => {
  const onAction = vi.fn();
  render(<AppointmentCard appointment={appt()} role="owner" actions={['edit', 'cancel']} onAction={onAction} />);
  expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Editar', 'Cancelar turno']);
  await userEvent.click(screen.getByRole('button', { name: /Cancelar turno.*Luz.*15:05/ }));
  expect(onAction).toHaveBeenCalledWith('cancel', expect.objectContaining({ id: 'a1' }));
});

test('sin acciones no hay botones', () => {
  render(<AppointmentCard appointment={appt({ status: 'cancelado' })} role="owner" actions={[]} onAction={() => {}} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
