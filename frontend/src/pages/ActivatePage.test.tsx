import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import ActivatePage from './ActivatePage';
import { publicService } from '../services/public';
import { authService } from '../services/auth';
import { ApiError } from '../services/api';

vi.mock('../services/public', () => ({ publicService: { activateAccount: vi.fn() } }));
vi.mock('../services/auth', () => ({ authService: { login: vi.fn() } }));
const pub = vi.mocked(publicService);
const auth = vi.mocked(authService);

const staffJwt = `h.${btoa(JSON.stringify({ id: 'u1', account_id: 'acc-1', role: 'staff' }))}.s`;
const USER = { id: 'u1', account_id: 'acc-1', name: 'Ana', email: 'ana@test.com', role: 'staff' as const, status: 'activo' as const, commission_rate: null };

beforeEach(() => {
  vi.resetAllMocks();
  pub.activateAccount.mockResolvedValue({ user: USER });
  auth.login.mockResolvedValue({ token: staffJwt });
});

function Where() {
  const loc = useLocation();
  return <p>Estás en {loc.pathname}{loc.search}</p>;
}

const renderAt = (url: string) => {
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/activar" element={<ActivatePage />} />
          <Route path="/staff/horario" element={<Where />} />
          <Route path="/login" element={<p>Inicio de sesión</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  return user;
};

const fill = async (user: ReturnType<typeof userEvent.setup>, pass: string, repeat = pass) => {
  await user.type(screen.getByLabelText('Contraseña'), pass);
  await user.type(screen.getByLabelText('Repite la contraseña'), repeat);
  await user.click(screen.getByRole('button', { name: 'Activar cuenta' }));
};

test('RF-24: sin token muestra el mensaje de enlace vencido y ningún formulario', () => {
  renderAt('/activar');
  expect(screen.getByRole('alert')).toHaveTextContent('Este enlace venció o ya se usó. Pídele al dueño del negocio uno nuevo');
  expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
});

test('RF-23: una contraseña corta o distinta de la repetición no se envía', async () => {
  const user = renderAt('/activar?token=tok');
  await fill(user, 'corta');
  expect(screen.getByRole('alert')).toHaveTextContent(/entre 8 y 72/);
  await user.clear(screen.getByLabelText('Contraseña'));
  await user.clear(screen.getByLabelText('Repite la contraseña'));
  await fill(user, 'clave-larga-1', 'clave-larga-2');
  expect(screen.getByRole('alert')).toHaveTextContent(/no coinciden/);
  expect(pub.activateAccount).not.toHaveBeenCalled();
});

test('RF-23: éxito → activa, inicia sesión con el email devuelto y entra a /staff/horario', async () => {
  const user = renderAt('/activar?token=tok');
  await fill(user, 'clave-larga-1');

  expect(pub.activateAccount).toHaveBeenCalledWith('tok', 'clave-larga-1');
  expect(auth.login).toHaveBeenCalledWith({ email: 'ana@test.com', password: 'clave-larga-1' });
  // `replace`: el token usado no queda en la URL (R3)
  expect(await screen.findByText('Estás en /staff/horario')).toBeInTheDocument();
  expect(localStorage.getItem('token')).toBe(staffJwt);
});

test('RF-24: 410 token_expired → mensaje sin formulario', async () => {
  pub.activateAccount.mockRejectedValue(new ApiError(410, 'token_expired'));
  const user = renderAt('/activar?token=viejo');
  await fill(user, 'clave-larga-1');
  expect(await screen.findByText(/venció o ya se usó/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
  expect(auth.login).not.toHaveBeenCalled();
});

test('otro error de la API se muestra en español y el formulario sigue disponible', async () => {
  pub.activateAccount.mockRejectedValue(new ApiError(429, 'too_many_requests'));
  const user = renderAt('/activar?token=tok');
  await fill(user, 'clave-larga-1');
  expect(await screen.findByRole('alert')).toHaveTextContent(/demasiados intentos/i);
  expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
});

test('si la cuenta se activa pero el login falla, lo dice y ofrece ir a iniciar sesión', async () => {
  auth.login.mockRejectedValue(new ApiError(0, 'network_error'));
  const user = renderAt('/activar?token=tok');
  await fill(user, 'clave-larga-1');
  expect(await screen.findByText(/Tu cuenta quedó activa/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Inicia sesión' })).toHaveAttribute('href', '/login');
});

test('RF-25: funciona con otra sesión abierta (la reemplaza al entrar)', async () => {
  localStorage.setItem('token', `h.${btoa(JSON.stringify({ id: 'o1', account_id: 'acc-1', role: 'owner' }))}.s`);
  const user = renderAt('/activar?token=tok');
  await fill(user, 'clave-larga-1');
  expect(await screen.findByText('Estás en /staff/horario')).toBeInTheDocument();
  expect(localStorage.getItem('token')).toBe(staffJwt);
});
