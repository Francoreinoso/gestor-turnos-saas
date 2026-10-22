import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import ServicesPage from './ServicesPage';
import { servicesService } from '../services/services';
import { ApiError } from '../services/api';
import type { Service } from '../domain/types';

vi.mock('../services/services', () => ({
  servicesService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), changePrice: vi.fn(), deactivate: vi.fn() },
}));
const svc = vi.mocked(servicesService);

const service = (over: Partial<Service> = {}): Service => ({
  id: 's1', account_id: 'acc-1', name: 'Corte', duration_minutes: 30, price: '8000.00', active: true, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem('token', `h.${btoa(JSON.stringify({ id: 'u1', account_id: 'acc-1', role: 'owner' }))}.s`);
  svc.list.mockResolvedValue([service(), service({ id: 's2', name: 'Barba', price: '5000.00', active: false })]);
});

const setup = async () => {
  const user = userEvent.setup();
  render(<AuthProvider><MemoryRouter><ServicesPage /></MemoryRouter></AuthProvider>);
  await screen.findByText('Corte');
  return user;
};

test('RF-4: separa activos de inactivos y muestra duración y precio en CLP', async () => {
  await setup();
  const active = screen.getByRole('region', { name: 'Servicios activos' });
  expect(within(active).getByText('Corte')).toBeInTheDocument();
  expect(within(active).getByText(/30 min · \$8\.000/)).toBeInTheDocument();
  const inactive = screen.getByRole('region', { name: 'Servicios inactivos' });
  expect(within(inactive).getByText('Barba')).toBeInTheDocument();
  expect(within(inactive).queryByRole('button')).not.toBeInTheDocument();
});

test('RF-5: crear agrega el servicio a la lista sin recargar y vacía el formulario', async () => {
  const user = await setup();
  svc.create.mockResolvedValue(service({ id: 's3', name: 'Tinte', duration_minutes: 90, price: '25000.00' }));

  await user.type(screen.getByLabelText('Nombre'), 'Tinte');
  await user.type(screen.getByLabelText('Duración (minutos)'), '90');
  await user.type(screen.getByLabelText('Precio (CLP)'), '25.000');
  await user.click(screen.getByRole('button', { name: 'Crear servicio' }));

  expect(svc.create).toHaveBeenCalledWith({ name: 'Tinte', duration_minutes: 90, price: '25000' });
  expect(await screen.findByText(/90 min · \$25\.000/)).toBeInTheDocument();
  expect(screen.getByLabelText('Nombre')).toHaveValue('');
  expect(svc.list).toHaveBeenCalledTimes(1);
});

test('RF-5: duración o precio inválidos no llaman a la API', async () => {
  const user = await setup();
  await user.type(screen.getByLabelText('Nombre'), 'Tinte');
  await user.type(screen.getByLabelText('Duración (minutos)'), '0');
  await user.type(screen.getByLabelText('Precio (CLP)'), '8000');
  await user.click(screen.getByRole('button', { name: 'Crear servicio' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/duración/i);

  await user.clear(screen.getByLabelText('Duración (minutos)'));
  await user.type(screen.getByLabelText('Duración (minutos)'), '30');
  await user.clear(screen.getByLabelText('Precio (CLP)'));
  await user.type(screen.getByLabelText('Precio (CLP)'), '8,5');
  await user.click(screen.getByRole('button', { name: 'Crear servicio' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/sin decimales/i);
  expect(svc.create).not.toHaveBeenCalled();
});

test('RF-8: un error de la API se muestra en español y el formulario conserva lo escrito', async () => {
  const user = await setup();
  svc.create.mockRejectedValue(new ApiError(400, 'invalid_body'));
  await user.type(screen.getByLabelText('Nombre'), 'Tinte');
  await user.type(screen.getByLabelText('Duración (minutos)'), '90');
  await user.type(screen.getByLabelText('Precio (CLP)'), '25000');
  await user.click(screen.getByRole('button', { name: 'Crear servicio' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/no es válido/i);
  expect(screen.getByLabelText('Nombre')).toHaveValue('Tinte');
  expect(screen.getByLabelText('Duración (minutos)')).toHaveValue('90');
  expect(screen.getByLabelText('Precio (CLP)')).toHaveValue('25000');
});

test('RF-6: editar nombre y duración llama a update', async () => {
  const user = await setup();
  svc.update.mockResolvedValue(service({ name: 'Corte clásico', duration_minutes: 45 }));
  await user.click(screen.getByRole('button', { name: 'Editar Corte' }));
  await user.clear(screen.getByLabelText('Nuevo nombre'));
  await user.type(screen.getByLabelText('Nuevo nombre'), 'Corte clásico');
  await user.clear(screen.getByLabelText('Nueva duración (minutos)'));
  await user.type(screen.getByLabelText('Nueva duración (minutos)'), '45');
  await user.click(screen.getByRole('button', { name: 'Guardar' }));

  expect(svc.update).toHaveBeenCalledWith('s1', { name: 'Corte clásico', duration_minutes: 45 });
  expect(await screen.findByText(/Corte clásico/)).toBeInTheDocument();
  expect(svc.changePrice).not.toHaveBeenCalled();
});

test('RF-6: cambiar el precio llama a changePrice', async () => {
  const user = await setup();
  svc.changePrice.mockResolvedValue(service({ price: '9500.00' }));
  await user.click(screen.getByRole('button', { name: 'Cambiar precio de Corte' }));
  await user.clear(screen.getByLabelText('Nuevo precio (CLP)'));
  await user.type(screen.getByLabelText('Nuevo precio (CLP)'), '9.500');
  await user.click(screen.getByRole('button', { name: 'Guardar' }));

  expect(svc.changePrice).toHaveBeenCalledWith('s1', '9500');
  expect(await screen.findByText(/\$9\.500/)).toBeInTheDocument();
  expect(svc.update).not.toHaveBeenCalled();
});

test('RF-7: desactivar pide confirmación y mueve el servicio a inactivos', async () => {
  const user = await setup();
  svc.deactivate.mockResolvedValue(service({ active: false }));
  await user.click(screen.getByRole('button', { name: 'Desactivar Corte' }));

  expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(/turnos que ya existen no cambian/i);
  expect(svc.deactivate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Desactivar' }));

  expect(svc.deactivate).toHaveBeenCalledWith('s1');
  const inactive = await screen.findByRole('region', { name: 'Servicios inactivos' });
  expect(within(inactive).getByText('Corte')).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

test('RF-7: cancelar la confirmación no desactiva nada', async () => {
  const user = await setup();
  await user.click(screen.getByRole('button', { name: 'Desactivar Corte' }));
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(svc.deactivate).not.toHaveBeenCalled();
});
