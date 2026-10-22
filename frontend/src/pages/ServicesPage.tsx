import { useEffect, useState } from 'react';
import AppNav from '../components/AppNav';
import ConfirmDialog from '../components/ConfirmDialog';
import ErrorNote from '../components/ErrorNote';
import { servicesService } from '../services/services';
import { ApiError } from '../services/api';
import { formatPrice } from '../domain/format';
import { parsePrice, PRICE_HINT } from '../domain/money';
import type { Service } from '../domain/types';

type Editing = { id: string; kind: 'details' | 'price' } | null;

const errorCode = (err: unknown) => (err instanceof ApiError ? err.message : 'error_desconocido');

// spec 009 RF-4..RF-8 — servicios de la cuenta: listar, crear, editar, cambiar precio y desactivar.
export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', duration: '', price: '' });
  const [formError, setFormError] = useState<{ code?: string; message?: string } | null>(null);

  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState({ name: '', duration: '', price: '' });
  const [editError, setEditError] = useState<{ code?: string; message?: string } | null>(null);

  const [confirming, setConfirming] = useState<Service | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    servicesService.list()
      .then(setServices)
      .catch(err => setLoadError(errorCode(err)))
      .finally(() => setLoading(false));
  }, []);

  const replace = (updated: Service) => setServices(list => list.map(s => (s.id === updated.id ? updated : s)));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const duration = Number(form.duration);
    if (!form.name.trim()) return setFormError({ code: 'missing_fields' });
    if (!Number.isInteger(duration) || duration <= 0) return setFormError({ message: 'La duración debe ser un número entero de minutos mayor que 0.' });
    let price: string;
    try { price = parsePrice(form.price); } catch { return setFormError({ message: PRICE_HINT }); }

    setBusy(true);
    try {
      const created = await servicesService.create({ name: form.name.trim(), duration_minutes: duration, price });
      setServices(list => [...list, created]);
      setForm({ name: '', duration: '', price: '' });
    } catch (err) {
      setFormError({ code: errorCode(err) }); // el formulario conserva lo escrito (RF-8)
    } finally {
      setBusy(false);
    }
  }

  function startEdit(service: Service, kind: 'details' | 'price') {
    setEditing({ id: service.id, kind });
    setDraft({ name: service.name, duration: String(service.duration_minutes), price: String(Math.round(Number(service.price))) });
    setEditError(null);
  }

  async function handleSave(service: Service) {
    if (!editing) return;
    setEditError(null);
    setBusy(true);
    try {
      if (editing.kind === 'price') {
        let price: string;
        try { price = parsePrice(draft.price); } catch { return setEditError({ message: PRICE_HINT }); }
        replace(await servicesService.changePrice(service.id, price));
      } else {
        const duration = Number(draft.duration);
        if (!draft.name.trim()) return setEditError({ code: 'missing_fields' });
        if (!Number.isInteger(duration) || duration <= 0) return setEditError({ message: 'La duración debe ser un número entero de minutos mayor que 0.' });
        replace(await servicesService.update(service.id, { name: draft.name.trim(), duration_minutes: duration }));
      }
      setEditing(null);
    } catch (err) {
      setEditError({ code: errorCode(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate() {
    if (!confirming) return;
    const target = confirming;
    setConfirming(null);
    setRowError(null);
    try {
      replace(await servicesService.deactivate(target.id));
    } catch (err) {
      setRowError(errorCode(err));
    }
  }

  const active = services.filter(s => s.active);
  const inactive = services.filter(s => !s.active);

  return (
    <>
      <AppNav />
      <main className="pub-page mgmt">
        <h1>Servicios</h1>

        <section aria-labelledby="new-service">
          <h2 id="new-service">Nuevo servicio</h2>
          <form className="pub-form" onSubmit={handleCreate} noValidate>
            <label>Nombre
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <label>Duración (minutos)
              <input inputMode="numeric" value={form.duration} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} />
            </label>
            <label>Precio (CLP)
              <input inputMode="numeric" placeholder="8.000" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            </label>
            <ErrorNote code={formError?.code} message={formError?.message} />
            <button type="submit" disabled={busy}>Crear servicio</button>
          </form>
        </section>

        <section aria-labelledby="active-services">
          <h2 id="active-services">Servicios activos</h2>
          {loading && <p className="pub-note">Cargando…</p>}
          {loadError && <ErrorNote code={loadError} />}
          {!loading && !loadError && active.length === 0 && <p className="pub-note">Todavía no tienes servicios activos.</p>}
          <ErrorNote code={rowError} />
          <ul className="pub-list">
            {active.map(s => (
              <li key={s.id} className="mgmt-row">
                {editing?.id === s.id ? (
                  <form className="pub-form" onSubmit={e => { e.preventDefault(); void handleSave(s); }} noValidate>
                    {editing.kind === 'details' ? (
                      <>
                        <label>Nuevo nombre
                          <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                        </label>
                        <label>Nueva duración (minutos)
                          <input inputMode="numeric" value={draft.duration} onChange={e => setDraft(d => ({ ...d, duration: e.target.value }))} />
                        </label>
                      </>
                    ) : (
                      <label>Nuevo precio (CLP)
                        <input inputMode="numeric" value={draft.price} onChange={e => setDraft(d => ({ ...d, price: e.target.value }))} />
                      </label>
                    )}
                    <ErrorNote code={editError?.code} message={editError?.message} />
                    <div className="pub-actions">
                      <button type="submit" disabled={busy}>Guardar</button>
                      <button type="button" className="pub-secondary" onClick={() => setEditing(null)}>Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="mgmt-row-main">
                      <strong>{s.name}</strong>
                      <span>{s.duration_minutes} min · {formatPrice(s.price)}</span>
                    </div>
                    <div className="pub-actions">
                      <button type="button" className="pub-secondary" aria-label={`Editar ${s.name}`} onClick={() => startEdit(s, 'details')}>Editar</button>
                      <button type="button" className="pub-secondary" aria-label={`Cambiar precio de ${s.name}`} onClick={() => startEdit(s, 'price')}>Cambiar precio</button>
                      <button type="button" className="pub-secondary" aria-label={`Desactivar ${s.name}`} onClick={() => setConfirming(s)}>Desactivar</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>

        {inactive.length > 0 && (
          <section aria-labelledby="inactive-services">
            <h2 id="inactive-services">Servicios inactivos</h2>
            <ul className="pub-list">
              {inactive.map(s => (
                <li key={s.id} className="mgmt-row mgmt-row--inactive">
                  <div className="mgmt-row-main">
                    <strong>{s.name}</strong>
                    <span>{s.duration_minutes} min · {formatPrice(s.price)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {confirming && (
          <ConfirmDialog title={`¿Desactivar ${confirming.name}?`} confirmLabel="Desactivar" onConfirm={handleDeactivate} onCancel={() => setConfirming(null)}>
            <p>Dejará de ofrecerse para reservar. Los turnos que ya existen no cambian.</p>
          </ConfirmDialog>
        )}
      </main>
    </>
  );
}
