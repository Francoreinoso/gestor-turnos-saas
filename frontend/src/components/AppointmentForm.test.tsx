import { test, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppointmentForm from './AppointmentForm';
import BlockForm from './BlockForm';
import { ApiError } from '../services/api';
import { toLocalIso } from '../domain/appointmentForm';
import type { Client, Service, StaffMember } from '../domain/types';

const services: Service[] = [{ id: 's1', account_id: 'a', name: 'Corte', duration_minutes: 60, price: '8000', active: true }];
const clients: Client[] = [{ id: 'c1', account_id: 'a', name: 'Luz', email: 'luz@x.cl', phone: null, notes: null }];
const staff: StaffMember[] = [{ id: 'u1', account_id: 'a', name: 'Ana', email: 'ana@x.cl', role: 'staff', status: 'activo', commission_rate: null }];
const day = new Date(2026, 4, 14);

const setup = (over: Partial<React.ComponentProps<typeof AppointmentForm>> = {}) => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(<AppointmentForm role="owner" selfId="o1" services={services} clients={clients} staff={staff} day={day} onSubmit={onSubmit} onCancel={onCancel} {...over} />);
  return { onSubmit, onCancel };
};

test('RF-7: la fecha por defecto es la del día mostrado y el profesional, "automático"', () => {
  setup();
  expect(screen.getByLabelText('Fecha')).toHaveValue('2026-05-14');
  expect(screen.getByLabelText('Profesional')).toHaveDisplayValue('Asignar automáticamente');
});

test('RF-11: el staff no ve el selector de profesional', () => {
  setup({ role: 'staff', selfId: 'u1' });
  expect(screen.queryByLabelText('Profesional')).not.toBeInTheDocument();
});

test('envía el cuerpo esperado con un cliente existente — RF-7, RF-8', async () => {
  const { onSubmit } = setup();
  await userEvent.selectOptions(screen.getByLabelText('Servicio'), 's1');
  await userEvent.click(screen.getByRole('button', { name: /Luz/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Crear turno' }));
  expect(onSubmit).toHaveBeenCalledWith({ service_id: 's1', scheduled_at: toLocalIso('2026-05-14', '10:00'), client_id: 'c1' });
});

test('valida localmente: sin servicio no envía y lo explica', async () => {
  const { onSubmit } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Crear turno' }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Elige un servicio.');
});

test('RF-10: un error de la API se muestra en español y conserva lo escrito', async () => {
  const onSubmit = vi.fn().mockRejectedValue(new ApiError(409, 'appointment_overlap'));
  setup({ onSubmit });
  await userEvent.selectOptions(screen.getByLabelText('Servicio'), 's1');
  await userEvent.click(screen.getByRole('button', { name: /Luz/ }));
  await userEvent.type(screen.getByLabelText('Notas (opcional)'), 'hola');
  await userEvent.click(screen.getByRole('button', { name: 'Crear turno' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/se cruza con otro turno/i);
  expect(screen.getByLabelText('Notas (opcional)')).toHaveValue('hola');
  expect(screen.getByLabelText('Servicio')).toHaveValue('s1');
});

test('RF-12: advierte, sin bloquear, si queda fuera del horario del profesional', async () => {
  // 2026-05-14 es jueves (4); el horario solo cubre el lunes
  const loadAvailability = vi.fn().mockResolvedValue([{ day_of_week: 1, start_time: '09:00', end_time: '18:00' }]);
  const { onSubmit } = setup({ loadAvailability });
  await userEvent.selectOptions(screen.getByLabelText('Servicio'), 's1');
  await userEvent.selectOptions(screen.getByLabelText('Profesional'), 'u1');
  expect(await screen.findByRole('status')).toHaveTextContent(/fuera del horario/i);
  await userEvent.click(screen.getByRole('button', { name: /Luz/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Crear turno' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
});

test('RF-12: dentro del horario no hay advertencia', async () => {
  const loadAvailability = vi.fn().mockResolvedValue([{ day_of_week: 4, start_time: '09:00', end_time: '18:00' }]);
  setup({ loadAvailability });
  await userEvent.selectOptions(screen.getByLabelText('Servicio'), 's1');
  await userEvent.selectOptions(screen.getByLabelText('Profesional'), 'u1');
  await waitFor(() => expect(loadAvailability).toHaveBeenCalledWith('u1'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('RF-19: la edición no muestra fecha ni hora y envía los campos editables', async () => {
  const { onSubmit } = setup({
    editing: { id: 'a1', account_id: 'a', client_id: 'c1', service_id: 's1', assigned_user_id: 'u1', scheduled_at: '', scheduled_until: '', status: 'agendado', notes: null },
  });
  expect(screen.queryByLabelText('Fecha')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Notas (opcional)'), 'nueva');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(onSubmit).toHaveBeenCalledWith({ service_id: 's1', client_id: 'c1', notes: 'nueva', assigned_user_id: 'u1' });
});

test('BlockForm: fin ≤ inicio se rechaza localmente — RF-16', async () => {
  const onSubmit = vi.fn();
  render(<BlockForm role="owner" staff={staff} day={day} onSubmit={onSubmit} onCancel={() => {}} />);
  await userEvent.clear(screen.getByLabelText('Hasta'));
  await userEvent.type(screen.getByLabelText('Hasta'), '13:00');
  await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(/posterior/i);
});

test('BlockForm: owner con "Todo el negocio" envía assigned_user_id null; el staff no elige — RF-14', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const { unmount } = render(<BlockForm role="owner" staff={staff} day={day} onSubmit={onSubmit} onCancel={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
  expect(onSubmit).toHaveBeenCalledWith({
    assigned_user_id: null, scheduled_at: toLocalIso('2026-05-14', '14:00'), scheduled_until: toLocalIso('2026-05-14', '18:00'),
  });
  unmount();
  render(<BlockForm role="staff" staff={[]} day={day} onSubmit={onSubmit} onCancel={() => {}} />);
  expect(screen.queryByLabelText('Aplica a')).not.toBeInTheDocument();
});

test('BlockForm: un error de la API se muestra y se conserva lo escrito', async () => {
  const onSubmit = vi.fn().mockRejectedValue(new ApiError(409, 'appointment_overlap'));
  render(<BlockForm role="owner" staff={staff} day={day} onSubmit={onSubmit} onCancel={() => {}} />);
  await userEvent.type(screen.getByLabelText('Nota (opcional)'), 'Trámite');
  await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/se cruza/i);
  expect(screen.getByLabelText('Nota (opcional)')).toHaveValue('Trámite');
});
