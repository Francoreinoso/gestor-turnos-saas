import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import DashboardPage from './DashboardPage';
import { appointmentsService } from '../services/appointments';
import { servicesService } from '../services/services';
import { clientsService } from '../services/clients';
import { staffService } from '../services/staff';
import { ApiError } from '../services/api';
import type { Appointment, AppointmentStatus } from '../domain/types';

vi.mock('../services/appointments', () => ({
  appointmentsService: { list: vi.fn(), create: vi.fn(), block: vi.fn(), edit: vi.fn(), cancel: vi.fn(), cancelBlock: vi.fn(), correct: vi.fn() },
}));
vi.mock('../services/services', () => ({ servicesService: { list: vi.fn() } }));
vi.mock('../services/clients', () => ({ clientsService: { list: vi.fn() } }));
vi.mock('../services/staff', () => ({ staffService: { list: vi.fn(), getAvailability: vi.fn() } }));

const login = (role: 'owner' | 'staff', id = role === 'owner' ? 'o1' : 'u1') =>
  localStorage.setItem('token', `h.${btoa(JSON.stringify({ id, account_id: 'acc-1', role }))}.s`);

const today = (h: number, m = 0) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), h, m);

const appt = (id: string, status: AppointmentStatus, h: number, over: Partial<Appointment> = {}): Appointment => ({
  id, account_id: 'acc-1', client_id: 'c1', service_id: 's1', assigned_user_id: 'u1',
  scheduled_at: today(h).toISOString(), scheduled_until: today(h + 1).toISOString(), status, notes: null,
  client: { id: 'c1', name: `Cliente ${id}`, email: null, phone: null },
  service: { id: 's1', name: 'Corte', duration_minutes: 60, price: '8000' },
  assignedUser: { id: 'u1', name: 'Ana' }, ...over,
});

const renderPage = () => render(<AuthProvider><MemoryRouter><DashboardPage /></MemoryRouter></AuthProvider>);

beforeEach(() => {
  vi.resetAllMocks();
  login('owner');
  vi.mocked(appointmentsService.list).mockResolvedValue([]);
  vi.mocked(staffService.list).mockResolvedValue([{ id: 'u1', account_id: 'acc-1', name: 'Ana', email: 'a@x.cl', role: 'staff', status: 'activo', commission_rate: null }]);
  vi.mocked(servicesService.list).mockResolvedValue([{ id: 's1', account_id: 'acc-1', name: 'Corte', duration_minutes: 60, price: '8000', active: true }]);
  vi.mocked(clientsService.list).mockResolvedValue([{ id: 'c1', account_id: 'acc-1', name: 'Luz', email: 'luz@x.cl', phone: null, notes: null }]);
  vi.mocked(staffService.getAvailability).mockResolvedValue([]);
});

test('RF-26: las horas de la agenda se muestran en 24 h (HH:mm) y el encabezado trae la navegación del panel', async () => {
  const start = new Date(); start.setHours(15, 5, 0, 0);
  const end = new Date(); end.setHours(15, 35, 0, 0);
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('a1', 'agendado', 15, { scheduled_at: start.toISOString(), scheduled_until: end.toISOString() })]);
  renderPage();
  expect(await screen.findByText('15:05')).toBeInTheDocument();
  expect(screen.getByText('15:35')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Servicios' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument();
});

test('RF-3: pide el día local y ordena por hora', async () => {
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('tarde', 'agendado', 16), appt('manana', 'agendado', 9)]);
  renderPage();
  await screen.findByText('Cliente manana');
  const names = screen.getAllByRole('article').map(a => within(a).getAllByText(/^Cliente/)[0].textContent);
  expect(names).toEqual(['Cliente manana', 'Cliente tarde']);
  const params = vi.mocked(appointmentsService.list).mock.calls[0][0]!;
  expect(new Date(params.date_from).getHours()).toBe(0);
  expect(new Date(params.date_to).getHours()).toBe(23);
});

test('RF-5: día vacío lo dice y ofrece "Nuevo turno"', async () => {
  renderPage();
  expect(await screen.findByText('No hay turnos para este día')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Nuevo turno' }).length).toBeGreaterThanOrEqual(2);
});

test('RF-6: con 500 elementos avisa que puede haber más', async () => {
  vi.mocked(appointmentsService.list).mockResolvedValue(Array.from({ length: 500 }, (_, i) => appt(`a${i}`, 'agendado', 9)));
  renderPage();
  expect(await screen.findByText(/puede haber más/i)).toBeInTheDocument();
});

test('un fallo al cargar se muestra en español', async () => {
  vi.mocked(appointmentsService.list).mockRejectedValue(new ApiError(0, 'network_error'));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos conectarnos/);
});

test('RF-4: el owner filtra por profesional; el staff no tiene el filtro', async () => {
  renderPage();
  await screen.findByText('No hay turnos para este día');
  await userEvent.selectOptions(await screen.findByLabelText('Profesional'), 'u1');
  await waitFor(() => expect(vi.mocked(appointmentsService.list).mock.calls[vi.mocked(appointmentsService.list).mock.calls.length - 1][0]).toMatchObject({ employee_id: 'u1' }));
});

test('RF-4: el staff no ve el filtro ni pide la lista del equipo', async () => {
  login('staff');
  renderPage();
  await screen.findByText('No hay turnos para este día');
  expect(screen.queryByLabelText('Profesional')).not.toBeInTheDocument();
  expect(staffService.list).not.toHaveBeenCalled();
});

test('RF-7, RF-9: crear un turno recarga la agenda y confirma', async () => {
  vi.mocked(appointmentsService.create).mockResolvedValue({ appointment: appt('nuevo', 'agendado', 18), access_token: 't' });
  renderPage();
  await screen.findByText('No hay turnos para este día');
  await userEvent.click(screen.getAllByRole('button', { name: 'Nuevo turno' })[0]);
  await userEvent.selectOptions(await screen.findByLabelText('Servicio'), 's1');
  await userEvent.click(await screen.findByRole('button', { name: /Luz/ }));
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('nuevo', 'agendado', 18)]);
  await userEvent.click(screen.getByRole('button', { name: 'Crear turno' }));
  expect(await screen.findByText('Cliente nuevo')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Turno creado.');
  expect(appointmentsService.create).toHaveBeenCalledWith(expect.objectContaining({ service_id: 's1', client_id: 'c1' }));
});

test('RF-9: un turno pasado queda completado y la pantalla lo informa', async () => {
  vi.mocked(appointmentsService.create).mockResolvedValue({ appointment: appt('viejo', 'completado', 9) });
  renderPage();
  await screen.findByText('No hay turnos para este día');
  await userEvent.click(screen.getAllByRole('button', { name: 'Nuevo turno' })[0]);
  await userEvent.selectOptions(await screen.findByLabelText('Servicio'), 's1');
  await userEvent.click(await screen.findByRole('button', { name: /Luz/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Crear turno' }));
  expect(await screen.findByText(/Quedó registrado como completado y generó su pago/)).toBeInTheDocument();
});

test('RF-10: si la API rechaza el turno, el formulario sigue abierto con el mensaje', async () => {
  vi.mocked(appointmentsService.create).mockRejectedValue(new ApiError(409, 'appointment_overlap'));
  renderPage();
  await screen.findByText('No hay turnos para este día');
  await userEvent.click(screen.getAllByRole('button', { name: 'Nuevo turno' })[0]);
  await userEvent.selectOptions(await screen.findByLabelText('Servicio'), 's1');
  await userEvent.click(await screen.findByRole('button', { name: /Luz/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Crear turno' }));
  expect(await screen.findByText(/se cruza con otro turno/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Crear turno' })).toBeInTheDocument();
});

test('RF-13: cancelar un turno pide confirmación y actualiza la fila', async () => {
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('a1', 'agendado', 15)]);
  vi.mocked(appointmentsService.cancel).mockResolvedValue({ id: 'a1', status: 'cancelado' } as Appointment); // la API devuelve la fila sin relaciones
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Cancelar turno/ }));
  expect(appointmentsService.cancel).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar turno' }));
  await waitFor(() => expect(appointmentsService.cancel).toHaveBeenCalledWith('a1'));
  expect(await screen.findByText('Cancelado')).toBeInTheDocument();
  expect(screen.getByText('Cliente a1')).toBeInTheDocument(); // conserva el cliente de la fila
  expect(screen.getByRole('status')).toHaveTextContent('Turno cancelado.');
});

test('RF-14: bloquear un horario llama a la API y recarga', async () => {
  vi.mocked(appointmentsService.block).mockResolvedValue(appt('b1', 'bloqueado', 14, { client_id: null, client: undefined }));
  renderPage();
  await screen.findByText('No hay turnos para este día');
  await userEvent.click(screen.getByRole('button', { name: 'Bloquear horario' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Bloquear' }));
  await waitFor(() => expect(appointmentsService.block).toHaveBeenCalledWith(expect.objectContaining({ assigned_user_id: null })));
  expect(await screen.findByText('Horario bloqueado.')).toBeInTheDocument();
});

test('RF-15: cancelar un bloqueo pide confirmación', async () => {
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('b1', 'bloqueado', 14, { client_id: null, client: undefined, service: undefined })]);
  vi.mocked(appointmentsService.cancelBlock).mockResolvedValue(appt('b1', 'cancelado', 14));
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Quitar bloqueo/ }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Quitar bloqueo' }));
  await waitFor(() => expect(appointmentsService.cancelBlock).toHaveBeenCalledWith('b1'));
});

test('RF-17, RF-18: marcar "no llegó" avisa que el pago se elimina y corrige', async () => {
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('a1', 'completado', 9)]);
  vi.mocked(appointmentsService.correct).mockResolvedValue(appt('a1', 'no_llego', 9));
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Marcar como no llegó/ }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent(/pago de este turno se elimina/i);
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Marcar como no llegó' }));
  expect(await screen.findByText('No llegó')).toBeInTheDocument();
  expect(appointmentsService.correct).toHaveBeenCalledWith('a1');
});

test('RF-18: marcar "completado" avisa que se crea el pago', async () => {
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('a1', 'no_llego', 9)]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Marcar como completado/ }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent(/se crea el pago/i);
});

test('RF-17: fuera de la ventana de corrección no hay botón', async () => {
  const old = new Date(); old.setDate(old.getDate() - 5);
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('a1', 'completado', 9, { scheduled_at: old.toISOString() })]);
  renderPage();
  await screen.findByText('Cliente a1');
  expect(screen.queryByRole('button', { name: /Marcar como/ })).not.toBeInTheDocument();
});

test('RF-17: correction_window_expired se explica', async () => {
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('a1', 'completado', 9)]);
  vi.mocked(appointmentsService.correct).mockRejectedValue(new ApiError(422, 'correction_window_expired'));
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Marcar como no llegó/ }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Marcar como no llegó' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/plazo para corregir/i);
});

test('RF-19: editar un turno agendado abre el formulario y recarga el día', async () => {
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('a1', 'agendado', 15)]);
  vi.mocked(appointmentsService.edit).mockResolvedValue(appt('a1', 'agendado', 15));
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Editar/ }));
  expect(await screen.findByRole('form', { name: 'Editar turno' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(appointmentsService.edit).toHaveBeenCalledWith('a1', expect.objectContaining({ service_id: 's1', client_id: 'c1' })));
  expect(await screen.findByText('Turno actualizado.')).toBeInTheDocument();
});

test('D7: el staff no ve botones sobre turnos de otro profesional', async () => {
  login('staff', 'u1');
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('a1', 'agendado', 15, { assigned_user_id: 'u2' })]);
  renderPage();
  await screen.findByText('Cliente a1');
  expect(screen.queryByRole('button', { name: /Cancelar turno/ })).not.toBeInTheDocument();
});

test('un 500 al cancelar se muestra y no cambia la fila', async () => {
  vi.mocked(appointmentsService.list).mockResolvedValue([appt('a1', 'agendado', 15)]);
  vi.mocked(appointmentsService.cancel).mockRejectedValue(new ApiError(500, 'error_desconocido'));
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Cancelar turno/ }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar turno' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/inesperado/i);
  expect(screen.getByText('Agendado')).toBeInTheDocument();
});
