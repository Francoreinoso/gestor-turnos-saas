import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// JWT de owner (solo el payload importa: parseToken lo decodifica en el cliente).
const ownerJwt = `h.${btoa(JSON.stringify({ id: 'u1', account_id: 'acc-1', role: 'owner' }))}.s`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem('token', ownerJwt);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

test('RF-32/RF-31: con sesión de owner, /reservar/:id muestra la página pública, no redirige y la sesión sigue', async () => {
  window.history.pushState({}, '', '/reservar/acc-1');
  fetchMock.mockImplementation(async () => json(200, {
    id: 'acc-1', business_name: 'Barbería Sur',
    services: [{ id: 's1', name: 'Corte', duration_minutes: 30, price: '1500.00' }],
    professionals: [{ id: 'p1', name: 'Ana' }],
  }));

  render(<App />);

  expect(await screen.findByRole('heading', { name: /barbería sur/i })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/reservar/acc-1');
  expect(localStorage.getItem('token')).toBe(ownerJwt);
  // RF-31: la llamada pública no lleva el JWT del panel.
  const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
  expect(headers.Authorization).toBeUndefined();
});

test('RF-32/RF-31: con sesión de owner, /turno/:id no redirige y un 401 público NO cierra la sesión', async () => {
  window.history.pushState({}, '', '/turno/apt-1?token=viejo');
  fetchMock.mockImplementation(async () => json(401, { error: 'token_expired' }));

  render(<App />);

  expect(await screen.findByText(/plazo para modificar/i)).toBeInTheDocument();
  expect(window.location.pathname).toBe('/turno/apt-1');
  expect(localStorage.getItem('token')).toBe(ownerJwt);
});

test('RF-32: sin sesión, /reservar/:id también es accesible', async () => {
  localStorage.clear();
  window.history.pushState({}, '', '/reservar/acc-1');
  fetchMock.mockImplementation(async () => json(404, { error: 'not_found' }));

  render(<App />);

  expect(await screen.findByText(/negocio no encontrado/i)).toBeInTheDocument();
  expect(window.location.pathname).toBe('/reservar/acc-1');
});

// ─── spec 009 RF-3, RF-25 · guardas de las pantallas de gestión ──────────────

const staffJwt = `h.${btoa(JSON.stringify({ id: 'u2', account_id: 'acc-1', role: 'staff' }))}.s`;

test('RF-3: un staff que abre /owner/equipo vuelve a su agenda', async () => {
  localStorage.setItem('token', staffJwt);
  window.history.pushState({}, '', '/owner/equipo');
  fetchMock.mockImplementation(async () => json(200, []));
  render(<App />);
  await screen.findByText(/no hay turnos para este día/i);
  expect(window.location.pathname).toBe('/staff/agenda');
});

test('RF-3: un owner que abre /staff/horario vuelve a su agenda', async () => {
  window.history.pushState({}, '', '/staff/horario');
  fetchMock.mockImplementation(async (url: string) => json(200, String(url).includes('/staff') ? { staff: [] } : []));
  render(<App />);
  await screen.findByText(/no hay turnos para este día/i);
  expect(window.location.pathname).toBe('/owner/agenda');
});

test('RF-3: sin sesión, /owner/servicios lleva a /login', async () => {
  localStorage.clear();
  window.history.pushState({}, '', '/owner/servicios');
  render(<App />);
  expect(await screen.findByRole('heading', { name: /iniciar sesión/i })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});

test('RF-3: el owner abre /owner/servicios y /owner/equipo', async () => {
  fetchMock.mockImplementation(async (url: string) => json(200, String(url).includes('/staff') ? { staff: [] } : []));
  window.history.pushState({}, '', '/owner/servicios');
  const { unmount } = render(<App />);
  expect(await screen.findByRole('heading', { name: 'Servicios' })).toBeInTheDocument();
  unmount();

  window.history.pushState({}, '', '/owner/equipo');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Equipo' })).toBeInTheDocument();
});

test('RF-25: /activar abre con sesión de owner, sin redirigir ni cerrar la sesión', async () => {
  window.history.pushState({}, '', '/activar?token=tok');
  render(<App />);
  expect(await screen.findByRole('heading', { name: /activa tu cuenta/i })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/activar');
  expect(localStorage.getItem('token')).toBe(ownerJwt);
});

test('RF-25: /activar abre sin sesión', async () => {
  localStorage.clear();
  window.history.pushState({}, '', '/activar?token=tok');
  render(<App />);
  expect(await screen.findByRole('heading', { name: /activa tu cuenta/i })).toBeInTheDocument();
});

// spec 010 RF-26 — pantalla de pagos con las mismas guardas por rol
test('RF-26: el owner abre /owner/pagos y el staff /staff/pagos', async () => {
  fetchMock.mockImplementation(async (url: string) => json(200, String(url).includes('/payments/summary')
    ? { totalAmount: 0, employeeAmount: 0, businessAmount: 0, paymentCount: 0, byEmployee: [] }
    : String(url).includes('/payments') ? { payments: [], hasMore: false } : { staff: [] }));
  window.history.pushState({}, '', '/owner/pagos');
  const { unmount } = render(<App />);
  expect(await screen.findByRole('heading', { name: 'Pagos' })).toBeInTheDocument();
  unmount();

  localStorage.setItem('token', staffJwt);
  window.history.pushState({}, '', '/staff/pagos');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Pagos' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/staff/pagos');
});

test('RF-26: un staff que abre /owner/pagos vuelve a su agenda y un owner que abre /staff/pagos, a la suya', async () => {
  fetchMock.mockImplementation(async (url: string) => json(200, String(url).includes('/staff') ? { staff: [] } : []));
  localStorage.setItem('token', staffJwt);
  window.history.pushState({}, '', '/owner/pagos');
  const { unmount } = render(<App />);
  await screen.findByText(/no hay turnos para este día/i);
  expect(window.location.pathname).toBe('/staff/agenda');
  unmount();

  localStorage.setItem('token', ownerJwt);
  window.history.pushState({}, '', '/staff/pagos');
  render(<App />);
  await screen.findByText(/no hay turnos para este día/i);
  expect(window.location.pathname).toBe('/owner/agenda');
});

test('RF-26: sin sesión, /owner/pagos lleva a /login', async () => {
  localStorage.clear();
  window.history.pushState({}, '', '/owner/pagos');
  render(<App />);
  expect(await screen.findByRole('heading', { name: /iniciar sesión/i })).toBeInTheDocument();
});
