import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppNav from '../components/AppNav';
import ConfirmDialog from '../components/ConfirmDialog';
import CopyLinkBox from '../components/CopyLinkBox';
import ErrorNote from '../components/ErrorNote';
import { staffService } from '../services/staff';
import { ApiError } from '../services/api';
import { percentToFraction, fractionToPercent } from '../domain/commission';
import { INVITATION_NOTICE } from '../domain/invitation';
import type { InvitationResult, StaffMember, StaffStatus } from '../domain/types';

const STATUS_LABEL: Record<StaffStatus, string> = { pendiente: 'Pendiente', activo: 'Activo', inactivo: 'Inactivo' };
const COMMISSION_HINT = 'La comisión debe ser un número entre 0 y 100.';

type Problem = { code?: string; message?: string } | null;
const errorCode = (err: unknown) => (err instanceof ApiError ? err.message : 'error_desconocido');

function invitationMessage(result: InvitationResult): string {
  const name = result.user.name;
  if (result.action === 'reactivate') return `Reactivamos a ${name}: vuelve a estar pendiente hasta que active su cuenta.`;
  if (result.action === 'resend') return `${name} ya tenía una invitación pendiente: generamos un enlace nuevo.`;
  return `Invitamos a ${name}.`;
}

// spec 009 RF-9..RF-14 — equipo: listar con filtro, invitar, editar, reenviar la invitación y desactivar.
export default function StaffPage() {
  const [filter, setFilter] = useState<StaffStatus | ''>('');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', email: '', commission: '' });
  const [formError, setFormError] = useState<Problem>(null);

  const [invitation, setInvitation] = useState<{ link: string; message: string } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', email: '', commission: '' });
  const [editError, setEditError] = useState<Problem>(null);
  const [editNote, setEditNote] = useState<string | null>(null);

  const [confirming, setConfirming] = useState<StaffMember | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cambiar el filtro o sumar 1 a `version` vuelve a pedir la lista.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion(v => v + 1);

  useEffect(() => {
    staffService.list(filter || undefined)
      .then(list => { setStaff(list); setLoadError(null); })
      .catch(err => setLoadError(errorCode(err)))
      .finally(() => setLoading(false));
  }, [filter, version]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim() || !form.email.trim()) return setFormError({ code: 'missing_fields' });
    let commission: number | null;
    try { commission = percentToFraction(form.commission); } catch { return setFormError({ message: COMMISSION_HINT }); }

    setBusy(true);
    try {
      const result = await staffService.invite({
        name: form.name.trim(),
        email: form.email.trim(),
        ...(commission !== null ? { commission_rate: commission } : {}),
      });
      setInvitation({ link: result.invitation_link, message: invitationMessage(result) });
      setForm({ name: '', email: '', commission: '' });
      reload();
    } catch (err) {
      setFormError({ code: errorCode(err) }); // el formulario conserva lo escrito (RF-8)
    } finally {
      setBusy(false);
    }
  }

  function startEdit(member: StaffMember) {
    setEditingId(member.id);
    setDraft({ name: member.name, email: member.email, commission: fractionToPercent(member.commission_rate) });
    setEditError(null);
    setEditNote(null);
  }

  async function handleSave(member: StaffMember) {
    setEditError(null);
    if (!draft.name.trim() || !draft.email.trim()) return setEditError({ code: 'missing_fields' });
    let commission: number | null;
    try { commission = percentToFraction(draft.commission); } catch { return setEditError({ message: COMMISSION_HINT }); }

    setBusy(true);
    try {
      const updated = await staffService.edit(member.id, { name: draft.name.trim(), email: draft.email.trim(), commission_rate: commission });
      setStaff(list => list.map(s => (s.id === updated.id ? updated : s)));
      setEditingId(null);
      if (member.status === 'pendiente' && updated.email !== member.email) {
        setEditNote(`Cambiaste el email de ${updated.name}: el enlace anterior ya no sirve. Usa «Reenviar invitación» para obtener uno nuevo.`);
      }
    } catch (err) {
      setEditError({ code: errorCode(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleResend(member: StaffMember) {
    setRowError(null);
    try {
      const result = await staffService.resendInvitation(member.id);
      setInvitation({ link: result.invitation_link, message: `Nuevo enlace para ${member.name}. El anterior ya no sirve.` });
    } catch (err) {
      setRowError(errorCode(err));
    }
  }

  async function handleDeactivate() {
    if (!confirming) return;
    const target = confirming;
    setConfirming(null);
    setRowError(null);
    try {
      await staffService.deactivate(target.id);
      reload();
    } catch (err) {
      setRowError(errorCode(err));
    }
  }

  return (
    <>
      <AppNav />
      <main className="pub-page mgmt">
        <h1>Equipo</h1>

        <section aria-labelledby="invite-staff">
          <h2 id="invite-staff">Invitar a un trabajador</h2>
          <form className="pub-form" onSubmit={handleInvite} noValidate>
            <label>Nombre
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <label>Email
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </label>
            <label>Comisión (%, opcional)
              <input inputMode="decimal" placeholder="Vacío = la de la cuenta" value={form.commission} onChange={e => setForm(f => ({ ...f, commission: e.target.value }))} />
            </label>
            <ErrorNote code={formError?.code} message={formError?.message} />
            <button type="submit" disabled={busy}>Invitar</button>
          </form>
          {invitation && (
            <div className="mgmt-invitation">
              <p role="status">{invitation.message}</p>
              <CopyLinkBox link={invitation.link} label="Enlace de activación" notice={INVITATION_NOTICE} />
            </div>
          )}
        </section>

        <section aria-labelledby="team-list">
          <h2 id="team-list">Trabajadores</h2>
          <label className="mgmt-filter">Estado
            <select value={filter} onChange={e => setFilter(e.target.value as StaffStatus | '')}>
              <option value="">Todos</option>
              <option value="pendiente">Pendientes</option>
              <option value="activo">Activos</option>
              <option value="inactivo">Inactivos</option>
            </select>
          </label>
          {loading && <p className="pub-note">Cargando…</p>}
          {loadError && <ErrorNote code={loadError} />}
          {!loading && !loadError && staff.length === 0 && <p className="pub-note">No hay trabajadores con ese estado.</p>}
          <ErrorNote code={rowError} />
          {editNote && <p role="status" className="pub-note">{editNote}</p>}
          <ul className="pub-list">
            {staff.map(m => (
              <li key={m.id} className="mgmt-row">
                {editingId === m.id ? (
                  <form className="pub-form" onSubmit={e => { e.preventDefault(); void handleSave(m); }} noValidate>
                    <label>Editar nombre
                      <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                    </label>
                    <label>Editar email
                      <input type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} />
                    </label>
                    <label>Editar comisión (%)
                      <input inputMode="decimal" placeholder="Vacío = la de la cuenta" value={draft.commission} onChange={e => setDraft(d => ({ ...d, commission: e.target.value }))} />
                    </label>
                    <ErrorNote code={editError?.code} message={editError?.message} />
                    <div className="pub-actions">
                      <button type="submit" disabled={busy}>Guardar</button>
                      <button type="button" className="pub-secondary" onClick={() => setEditingId(null)}>Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="mgmt-row-main">
                      <strong>{m.name}</strong>
                      <span>{m.email}</span>
                      <span>
                        <span className={`mgmt-badge mgmt-badge--${m.status}`}>{STATUS_LABEL[m.status]}</span>
                        {' · '}
                        {m.commission_rate === null ? 'Comisión de la cuenta' : `Comisión ${fractionToPercent(m.commission_rate)} %`}
                      </span>
                    </div>
                    {m.status !== 'inactivo' && (
                      <div className="pub-actions">
                        {m.role === 'staff' && (
                          <Link className="mgmt-link-button" to={`/owner/equipo/${m.id}/horario`} aria-label={`Horario de ${m.name}`}>Horario</Link>
                        )}
                        <button type="button" className="pub-secondary" aria-label={`Editar ${m.name}`} onClick={() => startEdit(m)}>Editar</button>
                        {m.status === 'pendiente' && (
                          <button type="button" className="pub-secondary" aria-label={`Reenviar invitación a ${m.name}`} onClick={() => handleResend(m)}>Reenviar invitación</button>
                        )}
                        <button type="button" className="pub-secondary" aria-label={`Desactivar a ${m.name}`} onClick={() => setConfirming(m)}>Desactivar</button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>

        {confirming && (
          <ConfirmDialog title={`¿Desactivar a ${confirming.name}?`} confirmLabel="Desactivar" onConfirm={handleDeactivate} onCancel={() => setConfirming(null)}>
            <p>Dejará de poder entrar y de recibir reservas. Sus turnos futuros se cancelarán; el historial se conserva.</p>
          </ConfirmDialog>
        )}
      </main>
    </>
  );
}
