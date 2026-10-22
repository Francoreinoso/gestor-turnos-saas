import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { AuthProvider } from '../context/AuthContext';
import { authService } from '../services/auth';
import { ApiError } from '../services/api';

vi.mock('../services/auth', () => ({ authService: { login: vi.fn(), register: vi.fn() } }));
const svc = vi.mocked(authService);

beforeEach(() => vi.resetAllMocks());

const renderPage = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );

const submitLogin = async (user: ReturnType<typeof userEvent.setup>, password: string) => {
  await user.type(screen.getByLabelText('Email'), 'ana@test.com');
  await user.type(screen.getByLabelText('Contraseña'), password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
};

// spec 008 RF-21
test('too_many_requests se muestra en español, no como código', async () => {
  svc.login.mockRejectedValue(new ApiError(429, 'too_many_requests'));
  renderPage();
  await submitLogin(userEvent.setup(), 'clave-incorrecta');

  expect(await screen.findByText('Demasiados intentos. Esperá unos minutos e intentá de nuevo.')).toBeInTheDocument();
  expect(screen.queryByText(/too_many_requests/)).not.toBeInTheDocument();
});

test('invalid_password (registro) se muestra en español, no como código', async () => {
  svc.register.mockRejectedValue(new ApiError(400, 'invalid_password'));
  const user = userEvent.setup();
  renderPage();

  await user.click(screen.getByRole('button', { name: 'Registrarse' }));
  await user.type(screen.getByLabelText('Nombre del negocio'), 'Mi negocio');
  await user.type(screen.getByLabelText('Tu nombre'), 'Ana');
  await user.type(screen.getByLabelText('Email'), 'ana@test.com');
  await user.type(screen.getByLabelText('Contraseña'), 'larga-123');
  await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));

  expect(await screen.findByText('La contraseña debe tener entre 8 y 72 caracteres.')).toBeInTheDocument();
  expect(screen.queryByText(/invalid_password/)).not.toBeInTheDocument();
});

test('un código desconocido o interno no se muestra crudo', async () => {
  for (const code of ['internal_error', 'payload_too_large', 'algo_nuevo']) {
    svc.login.mockRejectedValue(new ApiError(500, code));
    const { unmount } = renderPage();
    await submitLogin(userEvent.setup(), 'clave-incorrecta');
    expect(await screen.findByText(/Ocurrió un error/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(code))).not.toBeInTheDocument();
    unmount();
  }
});

test('los mensajes que ya existían siguen igual', async () => {
  svc.login.mockRejectedValue(new ApiError(401, 'invalid_credentials'));
  renderPage();
  await submitLogin(userEvent.setup(), 'clave-incorrecta');
  expect(await screen.findByText('Email o contraseña incorrectos.')).toBeInTheDocument();
});

// spec 008 RF-11, RF-21: el login no aplica la política de contraseña; el registro sí
test('login: la contraseña no declara minLength, un usuario con clave corta puede enviar el formulario', async () => {
  svc.login.mockRejectedValue(new ApiError(401, 'invalid_credentials'));
  renderPage();
  expect(screen.getByLabelText('Contraseña')).not.toHaveAttribute('minlength');

  await submitLogin(userEvent.setup(), 'abc');
  expect(svc.login).toHaveBeenCalledWith({ email: 'ana@test.com', password: 'abc' });
});

test('registro: la contraseña declara minLength=8 (la validación la hace el navegador)', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole('button', { name: 'Registrarse' }));
  expect(screen.getByLabelText('Contraseña')).toHaveAttribute('minlength', '8');

  // volver al login quita la restricción
  await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
  expect(screen.getByLabelText('Contraseña')).not.toHaveAttribute('minlength');
});
