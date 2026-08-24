import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/auth';
import { ApiError } from '../services/api';
import { parseToken, roleHome } from '../utils/token';

type Mode = 'login' | 'register';

const ERROR_LABELS: Record<string, string> = {
  missing_fields:      'Completá todos los campos.',
  email_taken:         'Ese email ya está registrado.',
  invalid_credentials: 'Email o contraseña incorrectos.',
};

export default function LoginPage() {
  const [mode, setMode]       = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const { login }  = useAuth();
  const navigate   = useNavigate();

  function toggleMode() {
    setMode(m => m === 'login' ? 'register' : 'login');
    setError('');
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;

    try {
      const res = mode === 'login'
        ? await authService.login({ email: data.email, password: data.password })
        : await authService.register({
            business_name: data.business_name,
            name:          data.name,
            email:         data.email,
            password:      data.password,
          });

      login(res.token);
      const payload = parseToken(res.token);
      navigate(payload ? roleHome(payload.role) : '/login');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'error_desconocido';
      setError(ERROR_LABELS[msg] ?? msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>{mode === 'login' ? 'Iniciar sesión' : 'Registrar negocio'}</h1>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <>
              <label>
                Nombre del negocio
                <input name="business_name" type="text" required autoFocus />
              </label>
              <label>
                Tu nombre
                <input name="name" type="text" required />
              </label>
            </>
          )}

          <label>
            Email
            <input name="email" type="email" required autoFocus={mode === 'login'} />
          </label>
          <label>
            Contraseña
            <input name="password" type="password" required minLength={8} />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? 'Cargando...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? '¿Negocio nuevo? ' : '¿Ya tenés cuenta? '}
          <button type="button" onClick={toggleMode}>
            {mode === 'login' ? 'Registrarse' : 'Iniciar sesión'}
          </button>
        </p>
      </div>
    </main>
  );
}
