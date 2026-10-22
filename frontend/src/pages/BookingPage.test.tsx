import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import BookingPage from './BookingPage';
import { publicService } from '../services/public';
import { ApiError } from '../services/api';
import type { PublicAccount, Slot, BookingResult } from '../domain/publicTypes';

vi.mock('../services/public', () => ({
  publicService: { getAccount: vi.fn(), getSlots: vi.fn(), book: vi.fn() },
}));

const svc = vi.mocked(publicService);

const ACCOUNT: PublicAccount = {
  id: 'acc-1',
  business_name: 'Barbería Sur',
  services: [
    { id: 'svc-corte', name: 'Corte', duration_minutes: 30, price: '1500.00' },
    { id: 'svc-barba', name: 'Barba', duration_minutes: 20, price: '900.00' },
  ],
  professionals: [{ id: 'usr-ana', name: 'Ana' }, { id: 'usr-beto', name: 'Beto' }],
};

// Slots de mañana (dentro de los 14 días), en hora local.
const tomorrowAt = (h: number) => {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d;
};
const slot = (employee_id: string, h: number): Slot => ({
  employee_id, starts_at: tomorrowAt(h).toISOString(), ends_at: new Date(tomorrowAt(h).getTime() + 1800000).toISOString(),
});

const RESULT: BookingResult = {
  appointment: {
    id: 'apt-1', status: 'agendado', scheduled_at: tomorrowAt(9).toISOString(), scheduled_until: tomorrowAt(10).toISOString(),
    assigned_user_id: 'usr-ana', service_id: 'svc-corte',
  },
  access_token: 'tok-abc',
};

beforeEach(() => {
  vi.resetAllMocks();
  svc.getAccount.mockResolvedValue(ACCOUNT);
  svc.getSlots.mockResolvedValue([slot('usr-ana', 9), slot('usr-beto', 9), slot('usr-ana', 10)]);
  svc.book.mockResolvedValue(RESULT);
});

function renderPage() {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/reservar/acc-1']}>
      <Routes><Route path="/reservar/:accountId" element={<BookingPage />} /></Routes>
    </MemoryRouter>,
  );
  return user;
}

const click = (user: ReturnType<typeof userEvent.setup>, name: string | RegExp) =>
  user.click(screen.getByRole('button', { name }));

// Recorre servicio → profesional → horario hasta el paso de datos.
async function toDetails(user: ReturnType<typeof userEvent.setup>, opts: { professional?: string; hour?: string } = {}) {
  await click(user, /Corte/);
  if (opts.professional) await user.click(screen.getByRole('radio', { name: opts.professional }));
  await click(user, /continuar/i);
  await click(user, await screen.findByRole('button', { name: opts.hour ?? '09:00' }).then(b => b.textContent!));
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>, data = { name: 'Lucía Pérez', email: 'lucia@example.com', phone: '' }) {
  await user.type(screen.getByLabelText(/nombre/i), data.name);
  if (data.email) await user.type(screen.getByLabelText(/email/i), data.email);
  if (data.phone) await user.type(screen.getByLabelText(/teléfono/i), data.phone);
}

// ─── T23 · carga y estados vacíos ────────────────────────────────────────────

test('RF-11: negocio inexistente → "Negocio no encontrado" sin formulario', async () => {
  svc.getAccount.mockRejectedValue(new ApiError(404, 'not_found'));
  renderPage();
  expect(await screen.findByText(/negocio no encontrado/i)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('RF-12: sin servicios activos → aviso y no continúa el flujo', async () => {
  svc.getAccount.mockResolvedValue({ ...ACCOUNT, services: [] });
  renderPage();
  expect(await screen.findByText(/todavía no acepta reservas online/i)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('RF-12: sin profesionales → el mismo aviso', async () => {
  svc.getAccount.mockResolvedValue({ ...ACCOUNT, professionals: [] });
  renderPage();
  expect(await screen.findByText(/todavía no acepta reservas online/i)).toBeInTheDocument();
});

test('RF-11/RF-13/RF-14: muestra negocio y servicios con duración y precio; avanza a profesional con "Cualquiera" por defecto', async () => {
  const user = renderPage();
  expect(await screen.findByRole('heading', { name: /barbería sur/i })).toBeInTheDocument();
  const corte = screen.getByRole('button', { name: /Corte/ });
  expect(corte).toHaveTextContent(/30 min/);
  expect(corte).toHaveTextContent(/1\.500/);

  await user.click(corte);

  expect(screen.getByRole('heading', { name: /elige un profesional/i })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /cualquiera/i })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Ana' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Beto' })).toBeInTheDocument();
});

test('un error de red al cargar el negocio muestra un mensaje en español', async () => {
  svc.getAccount.mockRejectedValue(new ApiError(0, 'network_error'));
  renderPage();
  expect(await screen.findByText(/no pudimos conectarnos/i)).toBeInTheDocument();
});

// ─── T24 · horario, datos y confirmación ─────────────────────────────────────

test('recorrido completo: llega al resumen y al enlace de gestión completo (RF-19, RF-20)', async () => {
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await toDetails(user);
  await fillDetails(user);
  await click(user, /continuar/i);

  expect(screen.getByRole('heading', { name: /confirma tu reserva/i })).toBeInTheDocument();
  await click(user, /confirmar reserva/i);

  expect(await screen.findByRole('heading', { name: /turno reservado/i })).toBeInTheDocument();
  expect(svc.book).toHaveBeenCalledTimes(1);
  const link = `${window.location.origin}/turno/apt-1?token=tok-abc`;
  expect(screen.getByDisplayValue(link)).toBeInTheDocument();
  expect(screen.getByText(/Corte/)).toBeInTheDocument();
  expect(screen.getByText(/Ana/)).toBeInTheDocument(); // profesional asignado
});

test('RF-16: "Cualquiera" muestra cada horario una sola vez y reserva sin employee_id', async () => {
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await click(user, /Corte/);
  await click(user, /continuar/i);

  expect(await screen.findAllByRole('button', { name: '09:00' })).toHaveLength(1);
  expect(svc.getSlots.mock.calls[0][1].employeeId).toBeNull();

  await click(user, '09:00');
  await fillDetails(user);
  await click(user, /continuar/i);
  await click(user, /confirmar reserva/i);

  await screen.findByRole('heading', { name: /turno reservado/i });
  const payload = svc.book.mock.calls[0][0];
  expect('employee_id' in payload).toBe(false);
  expect(payload).toMatchObject({ account_id: 'acc-1', service_id: 'svc-corte', scheduled_at: tomorrowAt(9).toISOString() });
  expect(payload.client).toEqual({ name: 'Lucía Pérez', email: 'lucia@example.com' });
});

test('RF-16: un profesional concreto pide sus horarios y envía su employee_id', async () => {
  svc.getSlots.mockResolvedValue([slot('usr-beto', 11)]);
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await toDetails(user, { professional: 'Beto', hour: '11:00' });
  await fillDetails(user);
  await click(user, /continuar/i);
  await click(user, /confirmar reserva/i);

  await screen.findByRole('heading', { name: /turno reservado/i });
  expect(svc.getSlots.mock.calls[0][1].employeeId).toBe('usr-beto');
  expect(svc.book.mock.calls[0][0].employee_id).toBe('usr-beto');
});

test('RF-15: pide los slots con una sola solicitud para el servicio elegido', async () => {
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await toDetails(user);
  expect(svc.getSlots).toHaveBeenCalledTimes(1);
  const [accountId, q] = svc.getSlots.mock.calls[0];
  expect(accountId).toBe('acc-1');
  expect(q.serviceId).toBe('svc-corte');
  expect(new Date(q.dateTo).getTime() - new Date(q.dateFrom).getTime()).toBeGreaterThanOrEqual(13 * 24 * 3600 * 1000);
});

test('RF-17: sin horarios en 14 días lo informa y permite volver a cambiar el servicio', async () => {
  svc.getSlots.mockResolvedValue([]);
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await click(user, /Corte/);
  await click(user, /continuar/i);

  expect(await screen.findByText(/no hay horarios disponibles/i)).toBeInTheDocument();
  await click(user, /volver/i);
  await click(user, /volver/i);
  expect(screen.getByRole('button', { name: /Barba/ })).toBeInTheDocument();
});

test('RF-18: la validación bloquea el envío y marca los campos', async () => {
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await toDetails(user);

  await click(user, /continuar/i);
  expect(screen.getByRole('heading', { name: /tus datos/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/nombre/i)).toBeInvalid();
  expect(screen.getByText(/ingresa tu nombre/i)).toBeInTheDocument();
  expect(screen.getByText(/email o un teléfono/i)).toBeInTheDocument();

  await user.type(screen.getByLabelText(/nombre/i), 'Lucía');
  await user.type(screen.getByLabelText(/teléfono/i), '1155551234');
  await click(user, /continuar/i);
  expect(screen.getByText(/ingresa el teléfono en formato internacional/i)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /tus datos/i })).toBeInTheDocument();
  expect(svc.book).not.toHaveBeenCalled();
});

test('RF-19: doble clic en "Confirmar reserva" → una sola llamada a book', async () => {
  let resolve!: (r: BookingResult) => void;
  svc.book.mockReturnValue(new Promise<BookingResult>(r => { resolve = r; }));
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await toDetails(user);
  await fillDetails(user);
  await click(user, /continuar/i);

  await user.dblClick(screen.getByRole('button', { name: /confirmar reserva/i }));

  expect(svc.book).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: /reservando/i })).toBeDisabled();
  resolve(RESULT);
  expect(await screen.findByRole('heading', { name: /turno reservado/i })).toBeInTheDocument();
});

test('RF-13: volver a un paso anterior conserva lo elegido', async () => {
  svc.getSlots.mockResolvedValue([slot('usr-beto', 9)]);
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await toDetails(user, { professional: 'Beto' });
  await fillDetails(user, { name: 'Lucía Pérez', email: '', phone: '+5491155551234' });

  await click(user, /volver/i); // → horario
  expect(screen.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'true');
  await click(user, /volver/i); // → profesional
  expect(screen.getByRole('radio', { name: 'Beto' })).toBeChecked();

  await click(user, /continuar/i); // mismos servicio y profesional: no vuelve a pedir slots
  expect(svc.getSlots).toHaveBeenCalledTimes(1);
  await click(user, /continuar/i);
  expect(screen.getByLabelText(/nombre/i)).toHaveValue('Lucía Pérez');
  expect(screen.getByLabelText(/teléfono/i)).toHaveValue('+5491155551234');
});

test('RF-13: cambiar de servicio descarta el horario elegido y vuelve a pedir slots', async () => {
  const user = renderPage();
  await screen.findByRole('heading', { name: /barbería sur/i });
  await toDetails(user);
  await click(user, /volver/i);
  await click(user, /volver/i);
  await click(user, /volver/i);
  await click(user, /Barba/);
  await click(user, /continuar/i);

  await waitFor(() => expect(svc.getSlots).toHaveBeenCalledTimes(2));
  expect(svc.getSlots.mock.calls[1][1].serviceId).toBe('svc-barba');
  expect((await screen.findByRole('button', { name: '09:00' }))).toHaveAttribute('aria-pressed', 'false');
});

// ─── T25 · errores de la reserva ─────────────────────────────────────────────

async function toConfirm(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: /barbería sur/i });
  await toDetails(user);
  await fillDetails(user);
  await click(user, /continuar/i);
}

test('RF-21: un 409 al confirmar recarga los slots, vuelve al horario y conserva los datos', async () => {
  svc.book.mockRejectedValueOnce(new ApiError(409, 'appointment_overlap'));
  const user = renderPage();
  await toConfirm(user);

  await click(user, /confirmar reserva/i);

  expect(await screen.findByRole('heading', { name: /elige día y horario/i })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(/ya no está disponible/i);
  expect(svc.getSlots).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'false');

  await click(user, '10:00');
  expect(screen.getByLabelText(/nombre/i)).toHaveValue('Lucía Pérez');
  expect(screen.getByLabelText(/email/i)).toHaveValue('lucia@example.com');
});

test('RF-21: también vuelve al horario con no_professional_available', async () => {
  svc.book.mockRejectedValueOnce(new ApiError(409, 'no_professional_available'));
  const user = renderPage();
  await toConfirm(user);
  await click(user, /confirmar reserva/i);
  expect(await screen.findByRole('heading', { name: /elige día y horario/i })).toBeInTheDocument();
});

test.each([
  [429, 'too_many_requests', /demasiados intentos/i],
  [400, 'missing_fields', /faltan datos/i],
  [0, 'network_error', /no pudimos conectarnos/i],
])('RF-22: %i (%s) → mensaje en español y se puede reintentar sin perder lo cargado', async (status, code, message) => {
  svc.book.mockRejectedValueOnce(new ApiError(status, code));
  const user = renderPage();
  await toConfirm(user);

  await click(user, /confirmar reserva/i);

  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('heading', { name: /confirma tu reserva/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /confirmar reserva/i })).toBeEnabled();

  await click(user, /confirmar reserva/i); // reintento
  expect(await screen.findByRole('heading', { name: /turno reservado/i })).toBeInTheDocument();
  expect(svc.book).toHaveBeenCalledTimes(2);
  expect(svc.book.mock.calls[1][0]).toEqual(svc.book.mock.calls[0][0]);
});

test('un error desconocido nunca muestra el código crudo', async () => {
  svc.book.mockRejectedValueOnce(new ApiError(500, 'internal_secret_code'));
  const user = renderPage();
  await toConfirm(user);
  await click(user, /confirmar reserva/i);
  expect(await screen.findByRole('alert')).not.toHaveTextContent(/internal_secret_code/);
});
