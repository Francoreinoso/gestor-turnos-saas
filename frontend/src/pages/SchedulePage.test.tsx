import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import SchedulePage from './SchedulePage';
import { staffService } from '../services/staff';
import { ApiError } from '../services/api';
import type { StaffMember } from '../domain/types';

vi.mock('../services/staff', () => ({
  staffService: { getAvailability: vi.fn(), replaceAvailability: vi.fn(), get: vi.fn(), editMe: vi.fn() },
}));
const svc = vi.mocked(staffService);

const ana: StaffMember = { id: 'u1', account_id: 'acc-1', name: 'Ana', email: 'ana@test.com', role: 'staff', status: 'activo', commission_rate: null };
const WINDOWS = [
  { day_of_week: 1, start_time: '09:00', end_time: '13:00' }, // lunes
  { day_of_week: 0, start_time: '10:00', end_time: '12:00' }, // domingo
];

const login = (role: 'owner' | 'staff', id: string) =>
  localStorage.setItem('token', `h.${btoa(JSON.stringify({ id, account_id: 'acc-1', role }))}.s`);

beforeEach(() => {
  vi.resetAllMocks();
  svc.getAvailability.mockResolvedValue(WINDOWS);
  svc.get.mockResolvedValue(ana);
  svc.replaceAvailability.mockImplementation(async (_id, windows) => windows);
});

const renderAs = async (role: 'owner' | 'staff', url: string) => {
  login(role, role === 'owner' ? 'o1' : 'u1');
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/owner/equipo/:id/horario" element={<SchedulePage />} />
          <Route path="/staff/horario" element={<SchedulePage />} />
          <Route path="/owner/equipo" element={<p>Pantalla de equipo</p>} />
          <Route path="/staff/agenda" element={<p>Pantalla de agenda</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  return user;
};

test('RF-15: carga el horario del trabajador y lo agrupa de lunes a domingo', async () => {
  await renderAs('owner', '/owner/equipo/u1/horario');
  expect(await screen.findByRole('heading', { name: 'Horario de Ana' })).toBeInTheDocument();
  expect(svc.getAvailability).toHaveBeenCalledWith('u1');
  expect(screen.getByLabelText('Lunes · desde')).toHaveValue('09:00');
  expect(screen.getByLabelText('Domingo · hasta')).toHaveValue('12:00');
});

test('RF-16: guardar envía todo el horario con replaceAvailability y lo confirma', async () => {
  const user = await renderAs('owner', '/owner/equipo/u1/horario');
  await screen.findByLabelText('Lunes · desde');
  await user.click(screen.getByRole('button', { name: 'Agregar tramo el martes' }));
  await user.click(screen.getByRole('button', { name: 'Guardar horario' }));

  expect(svc.replaceAvailability).toHaveBeenCalledTimes(1);
  const [id, sent] = svc.replaceAvailability.mock.calls[0];
  expect(id).toBe('u1');
  expect(sent).toHaveLength(3); // los dos que ya había + el nuevo: reemplazo total
  expect(sent).toContainEqual({ day_of_week: 2, start_time: '09:00', end_time: '18:00' }); // martes = 2 en la API
  expect(sent).toContainEqual({ day_of_week: 0, start_time: '10:00', end_time: '12:00' });
  expect(await screen.findByText('Horario guardado.')).toBeInTheDocument();
  expect(screen.queryByText(/cambios sin guardar/i)).not.toBeInTheDocument();
});

test('RF-17: la validación local bloquea el envío y marca la fila', async () => {
  const user = await renderAs('owner', '/owner/equipo/u1/horario');
  const hasta = await screen.findByLabelText('Lunes · hasta');
  fireEvent.change(hasta, { target: { value: '08:00' } });
  await user.click(screen.getByRole('button', { name: 'Guardar horario' }));
  expect(svc.replaceAvailability).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent(/inicio debe ser anterior/i);
});

test('RF-8: un error de la API se muestra en español y los cambios se conservan', async () => {
  const user = await renderAs('owner', '/owner/equipo/u1/horario');
  await screen.findByLabelText('Lunes · desde');
  svc.replaceAvailability.mockRejectedValue(new ApiError(422, 'overlapping_windows'));
  await user.click(screen.getByRole('button', { name: 'Agregar tramo el lunes' }));
  await user.click(screen.getByRole('button', { name: 'Guardar horario' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/se solapan/i);
  expect(screen.getByLabelText('Lunes · tramo 2 · desde')).toBeInTheDocument();
});

test('RF-18: un 404 muestra "Trabajador no encontrado"', async () => {
  svc.getAvailability.mockRejectedValue(new ApiError(404, 'not_found'));
  await renderAs('owner', '/owner/equipo/otro/horario');
  expect(await screen.findByRole('heading', { name: 'Trabajador no encontrado' })).toBeInTheDocument();
});

test('RF-19: "Volver" sin cambios navega directo', async () => {
  const user = await renderAs('owner', '/owner/equipo/u1/horario');
  await screen.findByLabelText('Lunes · desde');
  await user.click(screen.getByRole('button', { name: 'Volver' }));
  expect(screen.getByText('Pantalla de equipo')).toBeInTheDocument();
});

test('RF-19: "Volver" con cambios sin guardar pide confirmación', async () => {
  const user = await renderAs('owner', '/owner/equipo/u1/horario');
  await screen.findByLabelText('Lunes · desde');
  await user.click(screen.getByRole('button', { name: 'Agregar tramo el martes' }));
  await user.click(screen.getByRole('button', { name: 'Volver' }));

  expect(screen.getByRole('alertdialog', { name: '¿Salir sin guardar?' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByText('Pantalla de equipo')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Volver' }));
  await user.click(screen.getByRole('button', { name: 'Salir sin guardar' }));
  expect(screen.getByText('Pantalla de equipo')).toBeInTheDocument();
});

test('RF-19: con cambios sin guardar el navegador pide confirmar al cerrar; sin cambios no', async () => {
  const user = await renderAs('owner', '/owner/equipo/u1/horario');
  await screen.findByLabelText('Lunes · desde');
  const clean = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);

  await user.click(screen.getByRole('button', { name: 'Agregar tramo el martes' }));
  const dirty = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
});

test('RF-18, RF-20: como staff carga el horario propio y muestra "Mi perfil"', async () => {
  await renderAs('staff', '/staff/horario');
  expect(await screen.findByRole('heading', { name: 'Mi horario' })).toBeInTheDocument();
  expect(svc.getAvailability).toHaveBeenCalledWith('u1');
  expect(screen.getByRole('heading', { name: 'Mi perfil' })).toBeInTheDocument();
  expect(screen.getByLabelText('Nombre')).toHaveValue('Ana');
});

test('RF-20: editar nombre y contraseña llama a editMe; la contraseña corta se rechaza en el navegador', async () => {
  const user = await renderAs('staff', '/staff/horario');
  await screen.findByRole('heading', { name: 'Mi perfil' });
  svc.editMe.mockResolvedValue({ ...ana, name: 'Ana María' });

  await user.clear(screen.getByLabelText('Nombre'));
  await user.type(screen.getByLabelText('Nombre'), 'Ana María');
  await user.type(screen.getByLabelText(/Nueva contraseña/), 'corta');
  await user.click(screen.getByRole('button', { name: 'Guardar perfil' }));
  expect(svc.editMe).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(/entre 8 y 72/);

  await user.clear(screen.getByLabelText(/Nueva contraseña/));
  await user.type(screen.getByLabelText(/Nueva contraseña/), 'clave-larga-1');
  await user.click(screen.getByRole('button', { name: 'Guardar perfil' }));
  expect(svc.editMe).toHaveBeenCalledWith({ name: 'Ana María', password: 'clave-larga-1' });
  expect(await screen.findByText('Perfil actualizado.')).toBeInTheDocument();
  expect(screen.getByLabelText(/Nueva contraseña/)).toHaveValue('');
});

test('RF-20: como owner no se muestra "Mi perfil"', async () => {
  await renderAs('owner', '/owner/equipo/u1/horario');
  await screen.findByLabelText('Lunes · desde');
  expect(screen.queryByRole('heading', { name: 'Mi perfil' })).not.toBeInTheDocument();
});
