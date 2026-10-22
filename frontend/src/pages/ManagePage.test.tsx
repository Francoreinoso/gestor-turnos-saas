import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ManagePage from './ManagePage';
import { publicService } from '../services/public';
import { ApiError } from '../services/api';
import type { PublicAppointment, Slot, BookingResult } from '../domain/publicTypes';

vi.mock('../services/public', () => ({
  publicService: { getAppointment: vi.fn(), cancel: vi.fn(), getSlots: vi.fn(), reschedule: vi.fn() },
}));
const svc = vi.mocked(publicService);

const dayAt = (offset: number, h: number) => {
  const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, 0, 0, 0); return d;
};

const APPT: PublicAppointment = {
  id: 'apt-1', account_id: 'acc-1', status: 'agendado',
  scheduled_at: dayAt(3, 15).toISOString(), scheduled_until: dayAt(3, 16).toISOString(),
  service: { id: 'svc-corte', name: 'Corte', duration_minutes: 30, price: '1500.00' },
  professional: { id: 'usr-ana', name: 'Ana' },
  business_name: 'Barbería Sur',
};

const slotAt = (offset: number, h: number): Slot => ({
  employee_id: 'usr-ana', starts_at: dayAt(offset, h).toISOString(), ends_at: dayAt(offset, h + 1).toISOString(),
});

const MOVED: BookingResult = {
  appointment: {
    id: 'apt-2', status: 'agendado', scheduled_at: dayAt(5, 11).toISOString(), scheduled_until: dayAt(5, 12).toISOString(),
    assigned_user_id: 'usr-ana', service_id: 'svc-corte',
  },
  access_token: 'tok-2',
};

beforeEach(() => {
  vi.resetAllMocks();
  svc.getAppointment.mockResolvedValue(APPT);
  svc.getSlots.mockResolvedValue([slotAt(5, 11), slotAt(5, 12)]);
  svc.cancel.mockResolvedValue({ message: 'appointment_cancelled' });
  svc.reschedule.mockResolvedValue(MOVED);
});

function renderPage(url = '/turno/apt-1?token=tok-1') {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/turno/:id" element={<ManagePage />} /></Routes>
    </MemoryRouter>,
  );
  return user;
}
const btn = (name: string | RegExp) => screen.getByRole('button', { name });

// ─── T26 · consulta ──────────────────────────────────────────────────────────

test('RF-23: muestra negocio, servicio, profesional, fecha, hora y estado en español', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: /barbería sur/i })).toBeInTheDocument();
  expect(svc.getAppointment).toHaveBeenCalledWith('apt-1', 'tok-1');
  expect(screen.getByText(/Corte/)).toBeInTheDocument();
  expect(screen.getByText('Ana')).toBeInTheDocument();
  expect(screen.getByText(/15:00/)).toBeInTheDocument();
  expect(screen.getByText('Agendado')).toBeInTheDocument();
});

test('RF-24: token vencido → plazo vencido y comunicarse con el negocio, sin acciones', async () => {
  svc.getAppointment.mockRejectedValue(new ApiError(401, 'token_expired'));
  renderPage();
  expect(await screen.findByText(/plazo para modificar/i)).toBeInTheDocument();
  expect(screen.getByText(/comunicate con el negocio/i)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('RF-24: token incorrecto → "Enlace inválido"', async () => {
  svc.getAppointment.mockRejectedValue(new ApiError(401, 'unauthorized'));
  renderPage();
  expect(await screen.findByText(/enlace inválido/i)).toBeInTheDocument();
});

test('sin token en la URL → "Enlace inválido" sin llamar a la API', async () => {
  renderPage('/turno/apt-1');
  expect(await screen.findByText(/enlace inválido/i)).toBeInTheDocument();
  expect(svc.getAppointment).not.toHaveBeenCalled();
});

test('un error de red muestra un mensaje en español, no el código', async () => {
  svc.getAppointment.mockRejectedValue(new ApiError(0, 'network_error'));
  renderPage();
  expect(await screen.findByText(/no pudimos conectarnos/i)).toBeInTheDocument();
});

test('RF-25: agendado ofrece cancelar y reprogramar', async () => {
  renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  expect(btn('Cancelar turno')).toBeInTheDocument();
  expect(btn('Reprogramar')).toBeInTheDocument();
});

test.each(['cancelado', 'completado', 'no_llego', 'en_progreso'] as const)('RF-25: estado %s → solo información, sin acciones', async (status) => {
  svc.getAppointment.mockResolvedValue({ ...APPT, status });
  renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

// ─── T27 · cancelar y reprogramar ────────────────────────────────────────────

test('RF-26: cancelar exige confirmación explícita antes de llamar a la API', async () => {
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });

  await user.click(btn('Cancelar turno'));
  expect(svc.cancel).not.toHaveBeenCalled();
  expect(screen.getByText(/seguro que querés cancelar/i)).toBeInTheDocument();

  await user.click(btn(/no, volver/i));
  expect(svc.cancel).not.toHaveBeenCalled();
  expect(btn('Cancelar turno')).toBeInTheDocument();
});

test('RF-26: al confirmar cancela con el token y muestra el turno cancelado sin acciones', async () => {
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await user.click(btn('Cancelar turno'));
  await user.click(btn(/sí, cancelar/i));

  expect(await screen.findByText('Cancelado')).toBeInTheDocument();
  expect(svc.cancel).toHaveBeenCalledWith('apt-1', 'tok-1');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('RF-26: si cancelar falla, muestra el motivo y el turno sigue agendado', async () => {
  svc.cancel.mockRejectedValue(new ApiError(429, 'too_many_requests'));
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await user.click(btn('Cancelar turno'));
  await user.click(btn(/sí, cancelar/i));

  expect(await screen.findByRole('alert')).toHaveTextContent(/demasiados intentos/i);
  expect(screen.getByText('Agendado')).toBeInTheDocument();
});

test('RF-27: reprogramar pide slots del mismo servicio y profesional y pide confirmación al elegir uno', async () => {
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await user.click(btn('Reprogramar'));

  expect(await screen.findByRole('button', { name: '11:00' })).toBeInTheDocument();
  const [accountId, q] = svc.getSlots.mock.calls[0];
  expect(accountId).toBe('acc-1');
  expect(q.serviceId).toBe('svc-corte');
  expect(q.employeeId).toBe('usr-ana');

  await user.click(btn('11:00'));
  expect(svc.reschedule).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /confirmar reprogramación/i })).toBeInTheDocument();
});

test('RF-28: al confirmar muestra el turno nuevo y su NUEVO enlace; sin acciones', async () => {
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await user.click(btn('Reprogramar'));
  await user.click(await screen.findByRole('button', { name: '11:00' }));
  await user.click(btn(/confirmar reprogramación/i));

  expect(await screen.findByDisplayValue(`${window.location.origin}/turno/apt-2?token=tok-2`)).toBeInTheDocument();
  expect(svc.reschedule).toHaveBeenCalledWith('apt-1', 'tok-1', { scheduled_at: slotAt(5, 11).starts_at, employee_id: 'usr-ana' });
  expect(screen.getByText(/11:00/)).toBeInTheDocument();
  expect(screen.queryByDisplayValue(/token=tok-1/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^(cancelar turno|reprogramar)$/i })).not.toBeInTheDocument();
});

test.each([
  [409, 'appointment_overlap', /ya no está disponible/i],
  [422, 'appointment_in_past', /ya pasó/i],
])('RF-29: reprogramar con %i (%s) informa, recarga slots y el turno original sigue intacto', async (status, code, message) => {
  svc.reschedule.mockRejectedValue(new ApiError(status, code));
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await user.click(btn('Reprogramar'));
  await user.click(await screen.findByRole('button', { name: '11:00' }));
  await user.click(btn(/confirmar reprogramación/i));

  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(svc.getSlots).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '12:00' })).toBeInTheDocument(); // sigue en la elección de horario

  await user.click(btn(/volver/i));
  expect(screen.getByText('Agendado')).toBeInTheDocument();
  expect(btn('Cancelar turno')).toBeInTheDocument();
  expect(svc.cancel).not.toHaveBeenCalled();
});

test('RF-30: el token nunca llega a localStorage tras cancelar o reprogramar', async () => {
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await user.click(btn('Reprogramar'));
  await user.click(await screen.findByRole('button', { name: '11:00' }));
  await user.click(btn(/confirmar reprogramación/i));
  await screen.findByDisplayValue(/token=tok-2/);

  const dump = JSON.stringify({ ...localStorage }) + document.cookie + JSON.stringify({ ...sessionStorage });
  expect(dump).not.toMatch(/tok-1|tok-2/);
  expect(localStorage.length).toBe(0);
});
