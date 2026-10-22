import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ErrorNote from '../components/ErrorNote';
import { useAuth } from '../context/AuthContext';
import { publicService } from '../services/public';
import { authService } from '../services/auth';
import { ApiError } from '../services/api';
import { readActivationToken } from '../domain/invitation';

const EXPIRED = 'Este enlace venció o ya se usó. Pídele al dueño del negocio uno nuevo.';
const MAX_PASSWORD_BYTES = 72; // límite de bcrypt (spec 008 RF-11)

// spec 009 RF-23..RF-25 — el trabajador invitado define su contraseña desde el enlace y entra a "Mi horario".
// Es pública: usa el cliente sin JWT, así que funciona con o sin sesión abierta.
export default function ActivatePage() {
  const token = readActivationToken(useLocation().search);
  const { login } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<{ code?: string; message?: string } | null>(null);
  const [expired, setExpired] = useState(token === null);
  const [activatedWithoutLogin, setActivatedWithoutLogin] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    if (password.length < 8 || new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return setError({ code: 'invalid_password' });
    if (password !== repeat) return setError({ message: 'Las contraseñas no coinciden.' });

    setBusy(true);
    let email: string;
    try {
      email = (await publicService.activateAccount(token, password)).user.email;
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 410) return setExpired(true);
      return setError({ code: err instanceof ApiError ? err.message : 'error_desconocido' });
    }

    try {
      const { token: jwt } = await authService.login({ email, password });
      login(jwt);
      navigate('/staff/horario', { replace: true }); // R3: el token usado no queda en el historial
    } catch {
      setActivatedWithoutLogin(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pub-page mgmt">
      <h1>Activa tu cuenta</h1>

      {expired && <p role="alert" className="pub-error">{EXPIRED}</p>}

      {activatedWithoutLogin && (
        <p role="status" className="pub-success">
          Tu cuenta quedó activa, pero no pudimos iniciar tu sesión. <Link to="/login">Inicia sesión</Link> con tu email y la contraseña que elegiste.
        </p>
      )}

      {!expired && !activatedWithoutLogin && (
        <form className="pub-form" onSubmit={handleSubmit} noValidate>
          <p className="pub-note">Elige una contraseña para entrar al panel. Debe tener al menos 8 caracteres.</p>
          <label>Contraseña
            <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <label>Repite la contraseña
            <input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} />
          </label>
          <ErrorNote code={error?.code} message={error?.message} />
          <button type="submit" disabled={busy}>Activar cuenta</button>
        </form>
      )}
    </main>
  );
}
