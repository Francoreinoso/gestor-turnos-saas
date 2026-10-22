import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppNav from '../components/AppNav';
import ConfirmDialog from '../components/ConfirmDialog';
import ErrorNote from '../components/ErrorNote';
import ScheduleEditor from '../components/ScheduleEditor';
import { useAuth } from '../context/AuthContext';
import { staffService } from '../services/staff';
import { ApiError } from '../services/api';
import { emptyWeek, flattenSchedule, groupByDay, hasErrors, isDirty, validateSchedule } from '../domain/schedule';
import type { WeekDays } from '../domain/schedule';
import type { StaffMember } from '../domain/types';

const errorCode = (err: unknown) => (err instanceof ApiError ? err.message : 'error_desconocido');
const MAX_PASSWORD_BYTES = 72; // límite de bcrypt (spec 008 RF-11)

// spec 009 RF-15..RF-20 (D2) — una sola pantalla de horario para el owner (`/owner/equipo/:id/horario`)
// y para el staff (`/staff/horario`, además con su perfil).
export default function SchedulePage() {
  const { id: paramId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isSelf = paramId === undefined;
  const staffId = paramId ?? user?.id ?? '';

  const [worker, setWorker] = useState<StaffMember | null>(null);
  const [days, setDays] = useState<WeekDays>(emptyWeek());
  const [saved, setSaved] = useState<WeekDays>(emptyWeek());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const [profile, setProfile] = useState({ name: '', password: '' });
  const [profileError, setProfileError] = useState<{ code?: string; message?: string } | null>(null);
  const [profileOk, setProfileOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([staffService.getAvailability(staffId), staffService.get(staffId)])
      .then(([windows, member]) => {
        if (cancelled) return;
        const week = groupByDay(windows);
        setDays(week);
        setSaved(week);
        setWorker(member);
        setProfile(p => ({ ...p, name: member.name }));
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setLoadError(errorCode(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [staffId]);

  const errors = validateSchedule(days);
  const dirty = isDirty(days, saved);

  // RF-19: cerrar o recargar la pestaña con cambios sin guardar pide confirmación al navegador.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const backTo = isSelf ? '/staff/agenda' : '/owner/equipo';

  async function handleSave() {
    setAttempted(true);
    setSaveError(null);
    setSaveOk(false);
    if (hasErrors(errors)) return; // RF-17: no se llama a la API
    setSaving(true);
    try {
      const windows = await staffService.replaceAvailability(staffId, flattenSchedule(days));
      const week = groupByDay(windows);
      setDays(week);
      setSaved(week);
      setAttempted(false);
      setSaveOk(true);
    } catch (err) {
      setSaveError(errorCode(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileOk(false);
    const body: { name?: string; password?: string } = {};
    if (profile.name.trim() && profile.name.trim() !== worker?.name) body.name = profile.name.trim();
    if (profile.password) {
      const bytes = new TextEncoder().encode(profile.password).length;
      if (profile.password.length < 8 || bytes > MAX_PASSWORD_BYTES) return setProfileError({ code: 'invalid_password' });
      body.password = profile.password;
    }
    if (Object.keys(body).length === 0) return setProfileError({ message: 'No hay cambios para guardar.' });
    try {
      const updated = await staffService.editMe(body);
      setWorker(updated);
      setProfile({ name: updated.name, password: '' });
      setProfileOk(true);
    } catch (err) {
      setProfileError({ code: errorCode(err) });
    }
  }

  if (loading) return <><AppNav /><main className="pub-page mgmt"><p className="pub-note">Cargando…</p></main></>;
  if (notFound) return <><AppNav /><main className="pub-page mgmt"><h1>Trabajador no encontrado</h1></main></>;
  if (loadError) return <><AppNav /><main className="pub-page mgmt"><ErrorNote code={loadError} /></main></>;

  return (
    <>
      <AppNav />
      <main className="pub-page mgmt">
        <h1>{isSelf ? 'Mi horario' : `Horario de ${worker?.name ?? ''}`}</h1>
        <p className="pub-note">Define los días y las horas en que se pueden reservar turnos. Un día sin tramos es un día sin atención.</p>

        <ScheduleEditor days={days} errors={attempted ? errors : errors.map(() => null)} onChange={next => { setDays(next); setSaveOk(false); }} />

        <ErrorNote code={saveError} />
        {saveOk && <p role="status" className="pub-success">Horario guardado.</p>}
        {dirty && !saveOk && <p className="pub-note">Tienes cambios sin guardar.</p>}
        <div className="pub-actions">
          <button type="button" onClick={handleSave} disabled={saving}>Guardar horario</button>
          <button type="button" className="pub-secondary" onClick={() => (dirty ? setLeaving(true) : navigate(backTo))}>Volver</button>
        </div>

        {isSelf && (
          <section aria-labelledby="my-profile">
            <h2 id="my-profile">Mi perfil</h2>
            <form className="pub-form" onSubmit={handleProfile} noValidate>
              <label>Nombre
                <input value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
              </label>
              <label>Nueva contraseña (opcional)
                <input type="password" autoComplete="new-password" value={profile.password} onChange={e => setProfile(p => ({ ...p, password: e.target.value }))} />
              </label>
              <p className="pub-note">Mínimo 8 caracteres. Tu email y tu comisión los gestiona el dueño del negocio.</p>
              <ErrorNote code={profileError?.code} message={profileError?.message} />
              {profileOk && <p role="status" className="pub-success">Perfil actualizado.</p>}
              <button type="submit">Guardar perfil</button>
            </form>
          </section>
        )}

        {leaving && (
          <ConfirmDialog title="¿Salir sin guardar?" confirmLabel="Salir sin guardar" onConfirm={() => navigate(backTo)} onCancel={() => setLeaving(false)}>
            <p>Hiciste cambios en el horario que todavía no guardaste. Si sales, se pierden.</p>
          </ConfirmDialog>
        )}
      </main>
    </>
  );
}
