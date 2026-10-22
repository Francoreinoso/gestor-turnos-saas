import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import StaffPage from './StaffPage';
import { staffService } from '../services/staff';
import { ApiError } from '../services/api';
import type { StaffMember } from '../domain/types';

vi.mock('../services/staff', () => ({
  staffService: { list: vi.fn(), invite: vi.fn(), edit: vi.fn(), resendInvitation: vi.fn(), deactivate: vi.fn() },
}));
const svc = vi.mocked(staffService);

const member = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 'u1', account_id: 'acc-1', name: 'Ana', email: 'ana@test.com', role: 'staff', status: 'activo', commission_rate: '0.2500', ...over,
});
const LINK = 'http://localhost:5173/activar?token=abc';

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem('token', `h.${btoa(JSON.stringify({ id: 'o1', account_id: 'acc-1', role: 'owner' }))}.s`);
  svc.list.mockResolvedValue([
    member(),
    member({ id: 'u2', name: 'Beto', email: 'beto@test.com', status: 'pendiente', commission_rate: null }),
    member({ id: 'u3', name: 'Caro', email: 'caro@test.com', status: 'inactivo' }),
  ]);
});

const setup = async () => {
  const user = userEvent.setup();
  render(<AuthProvider><MemoryRouter><StaffPage /></MemoryRouter></AuthProvider>);
  await screen.findByText('Ana');
  return user;
};
const fillInvite = async (user: ReturnType<typeof userEvent.setup>, name = 'Dani', email = 'dani@test.com', commission = '') => {
  await user.type(screen.getByLabelText('Nombre'), name);
  await user.type(screen.getByLabelText('Email'), email);
  if (commission) await user.type(screen.getByLabelText(/Comisión \(%, opcional\)/), commission);
};

test('RF-9: lista nombre, email, estado y comisión', async () => {
  await setup();
  expect(screen.getByText('ana@test.com')).toBeInTheDocument();
  expect(screen.getByText('Activo')).toBeInTheDocument();
  expect(screen.getByText('Pendiente')).toBeInTheDocument();
  expect(screen.getByText('Inactivo')).toBeInTheDocument();
  expect(screen.getAllByText(/Comisión 25 %/)).toHaveLength(2); // Ana y Caro
  expect(screen.getByText(/Comisión de la cuenta/)).toBeInTheDocument();
});

test('RF-9: el filtro por estado vuelve a pedir la lista con ?status=', async () => {
  const user = await setup();
  await user.selectOptions(screen.getByLabelText('Estado'), 'pendiente');
  expect(svc.list).toHaveBeenLastCalledWith('pendiente');
  await user.selectOptions(screen.getByLabelText('Estado'), '');
  expect(svc.list).toHaveBeenLastCalledWith(undefined);
});

test('RF-10, RF-11: invitar muestra el enlace de activación con "Copiar" y el aviso', async () => {
  const user = await setup();
  svc.invite.mockResolvedValue({ user: member({ id: 'u4', name: 'Dani' }), invitation_link: LINK, action: 'create' });
  await fillInvite(user, 'Dani', 'dani@test.com', '30');
  await user.click(screen.getByRole('button', { name: 'Invitar' }));

  expect(svc.invite).toHaveBeenCalledWith({ name: 'Dani', email: 'dani@test.com', commission_rate: 0.3 });
  expect(await screen.findByLabelText('Enlace de activación')).toHaveValue(LINK);
  expect(screen.getByText(/Aún no enviamos emails: entrégale este enlace al trabajador. Vence en 72 horas/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /copiar/i })).toBeInTheDocument();
  expect(screen.getByLabelText('Nombre')).toHaveValue('');
});

test('RF-10: sin comisión no envía commission_rate', async () => {
  const user = await setup();
  svc.invite.mockResolvedValue({ user: member({ id: 'u4', name: 'Dani' }), invitation_link: LINK, action: 'create' });
  await fillInvite(user);
  await user.click(screen.getByRole('button', { name: 'Invitar' }));
  expect(svc.invite).toHaveBeenCalledWith({ name: 'Dani', email: 'dani@test.com' });
});

test('RF-10: email_taken se muestra como "ese email ya está en uso" y conserva lo escrito', async () => {
  const user = await setup();
  svc.invite.mockRejectedValue(new ApiError(409, 'email_taken'));
  await fillInvite(user);
  await user.click(screen.getByRole('button', { name: 'Invitar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/ese email ya está en uso/i);
  expect(screen.getByLabelText('Nombre')).toHaveValue('Dani');
  expect(screen.getByLabelText('Email')).toHaveValue('dani@test.com');
});

test('RF-10, R5: la reactivación de un inactivo se comunica', async () => {
  const user = await setup();
  svc.invite.mockResolvedValue({ user: member({ name: 'Caro' }), invitation_link: LINK, action: 'reactivate' });
  await fillInvite(user, 'Caro', 'caro@test.com');
  await user.click(screen.getByRole('button', { name: 'Invitar' }));
  expect(await screen.findByText(/Reactivamos a Caro/)).toBeInTheDocument();
});

test('RF-10: una comisión fuera de 0–100 no llama a la API', async () => {
  const user = await setup();
  await fillInvite(user, 'Dani', 'dani@test.com', '150');
  await user.click(screen.getByRole('button', { name: 'Invitar' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/entre 0 y 100/);
  expect(svc.invite).not.toHaveBeenCalled();
});

test('RF-12: editar con la comisión vacía envía null', async () => {
  const user = await setup();
  svc.edit.mockResolvedValue(member({ name: 'Ana María', commission_rate: null }));
  await user.click(screen.getByRole('button', { name: 'Editar Ana' }));
  await user.clear(screen.getByLabelText('Editar nombre'));
  await user.type(screen.getByLabelText('Editar nombre'), 'Ana María');
  await user.clear(screen.getByLabelText('Editar comisión (%)'));
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(svc.edit).toHaveBeenCalledWith('u1', { name: 'Ana María', email: 'ana@test.com', commission_rate: null });
  expect(await screen.findByText('Ana María')).toBeInTheDocument();
});

test('RF-13: "Reenviar invitación" solo aparece en pendientes y muestra el enlace nuevo', async () => {
  const user = await setup();
  expect(screen.getAllByRole('button', { name: /Reenviar invitación/ })).toHaveLength(1);
  svc.resendInvitation.mockResolvedValue({ user: member({ id: 'u2' }), invitation_link: LINK });
  await user.click(screen.getByRole('button', { name: 'Reenviar invitación a Beto' }));
  expect(svc.resendInvitation).toHaveBeenCalledWith('u2');
  expect(await screen.findByLabelText('Enlace de activación')).toHaveValue(LINK);
});

test('RF-14: desactivar pide confirmación con aviso de turnos futuros', async () => {
  const user = await setup();
  svc.deactivate.mockResolvedValue(member({ status: 'inactivo' }));
  await user.click(screen.getByRole('button', { name: 'Desactivar a Ana' }));
  expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(/turnos futuros se cancelarán/i);
  expect(svc.deactivate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Desactivar' }));
  expect(svc.deactivate).toHaveBeenCalledWith('u1');
});

test('D5: "Horario" solo para rol staff y para trabajadores no inactivos', async () => {
  svc.list.mockResolvedValue([member(), member({ id: 'u3', name: 'Caro', email: 'caro@test.com', status: 'inactivo' }), member({ id: 'o2', name: 'Otro', email: 'otro@test.com', role: 'owner' })]);
  await setup();
  const links = screen.getAllByRole('link').map(l => l.getAttribute('href'));
  expect(links.filter(h => h?.endsWith('/horario'))).toEqual(['/owner/equipo/u1/horario']);
  const row = screen.getByText('ana@test.com').closest('li') as HTMLElement;
  expect(within(row).getByRole('link', { name: 'Horario de Ana' })).toBeInTheDocument();
});
