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
