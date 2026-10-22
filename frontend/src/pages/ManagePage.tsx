import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { publicService } from '../services/public';
import { ApiError } from '../services/api';
import SlotPicker from '../components/SlotPicker';
import ManageLinkBox from '../components/ManageLinkBox';
import { manageLink } from '../domain/booking';
import { publicErrorMessage } from '../domain/errors';
import { formatDateTime, formatPrice, statusLabel } from '../domain/format';
import { groupByDay, rangeFor, DEFAULT_DAYS } from '../domain/slots';
import type { PublicAppointment, Slot } from '../domain/publicTypes';

type Load =
  | { status: 'loading' }
  | { status: 'ready'; appointment: PublicAppointment }
  | { status: 'failed'; message: string };

type Mode = 'view' | 'confirm_cancel' | 'pick_slot' | 'moved';

const messageFor = (err: unknown) => publicErrorMessage(err instanceof ApiError ? err.message : undefined);

// Gestión de un turno por su enlace (spec 005 RF-23..RF-30). El token vive solo en la URL abierta.
export default function ManagePage() {
  const { id = '' } = useParams();
  const token = useSearchParams()[0].get('token');

  const [load, setLoad] = useState<Load>(token ? { status: 'loading' } : { status: 'failed', message: publicErrorMessage('unauthorized') });
  const [mode, setMode] = useState<Mode>('view');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [rangeFrom, setRangeFrom] = useState(() => new Date());
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [newLink, setNewLink] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    publicService.getAppointment(id, token)
      .then(appointment => { if (!cancelled) setLoad({ status: 'ready', appointment }); })
      .catch(err => { if (!cancelled) setLoad({ status: 'failed', message: messageFor(err) }); });
    return () => { cancelled = true; };
  }, [id, token]);

  if (load.status === 'loading') return <main className="pub-page"><p className="pub-note" role="status">Cargando…</p></main>;
  if (load.status === 'failed') {
    return (
      <main className="pub-page">
        <p className="pub-error" role="alert">{load.message}</p>
      </main>
    );
  }

  const appointment = load.appointment;
  const { service, professional } = appointment;
  const canAct = appointment.status === 'agendado' && mode !== 'moved';

  // Evita acciones duplicadas mientras hay una solicitud en curso.
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function loadSlots() {
    const from = new Date();
    const { date_from, date_to } = rangeFor(from);
    const list = await publicService.getSlots(appointment.account_id, {
      serviceId: service!.id, employeeId: professional?.id ?? null, dateFrom: date_from, dateTo: date_to,
    });
    setRangeFrom(from);
    setSlots(list);
  }

  function startReschedule() {
    return run(async () => {
      setChosen(null);
      setMode('pick_slot');
      setSlots(null);
      try {
        await loadSlots();
      } catch (err) {
        setSlots([]);
        setError(messageFor(err));
      }
    });
  }

  function confirmCancel() {
    return run(async () => {
      try {
        await publicService.cancel(id, token!);
        setLoad({ status: 'ready', appointment: { ...appointment, status: 'cancelado' } });
        setMode('view');
      } catch (err) {
        setError(messageFor(err));
        setMode('view');
      }
    });
  }

  function confirmReschedule() {
    return run(async () => {
      try {
        const res = await publicService.reschedule(id, token!, {
          scheduled_at: chosen!.starts_at,
          ...(professional ? { employee_id: professional.id } : {}),
        });
        // RF-28: el turno nuevo tiene su propio enlace; el anterior ya no sirve para actuar.
        setLoad({
          status: 'ready',
          appointment: {
            ...appointment,
            id: res.appointment.id,
            status: res.appointment.status,
            scheduled_at: res.appointment.scheduled_at,
            scheduled_until: res.appointment.scheduled_until,
          },
        });
        setNewLink(manageLink(window.location.origin, res.appointment.id, res.access_token));
        setMode('moved');
      } catch (err) {
        // RF-29: el turno original sigue intacto; se recargan los horarios.
        const msg = messageFor(err);
        setChosen(null);
        setSlots(null);
        try {
          await loadSlots();
        } catch {
          setSlots([]);
        }
        setError(msg);
      }
    });
  }

  return (
    <main className="pub-page">
      <h1>{appointment.business_name ?? 'Tu turno'}</h1>

      {mode === 'moved' && <p className="pub-success" role="status">Tu turno fue reprogramado.</p>}
      {error && <p className="pub-error" role="alert">{error}</p>}

      <dl className="pub-summary">
        <dt>Servicio</dt>
        <dd>{service ? `${service.name} (${service.duration_minutes} min · ${formatPrice(service.price)})` : '—'}</dd>
        <dt>Profesional</dt>
        <dd>{professional?.name ?? '—'}</dd>
        <dt>Fecha y hora</dt>
        <dd>{formatDateTime(appointment.scheduled_at)}</dd>
        <dt>Estado</dt>
        <dd>{statusLabel(appointment.status)}</dd>
      </dl>

      {mode === 'moved' && <ManageLinkBox link={newLink} />}

      {canAct && mode === 'view' && (
        <div className="pub-actions">
          <button type="button" className="pub-danger" onClick={() => { setError(''); setMode('confirm_cancel'); }} disabled={busy}>
            Cancelar turno
          </button>
          {service && <button type="button" onClick={startReschedule} disabled={busy}>Reprogramar</button>}
        </div>
      )}

      {canAct && mode === 'confirm_cancel' && (
        <section>
          <p>¿Seguro que querés cancelar tu turno? Esta acción no se puede deshacer.</p>
          <div className="pub-actions">
            <button type="button" className="pub-secondary" onClick={() => setMode('view')} disabled={busy}>No, volver</button>
            <button type="button" className="pub-danger" onClick={confirmCancel} disabled={busy}>Sí, cancelar turno</button>
          </div>
        </section>
      )}

      {canAct && mode === 'pick_slot' && (
        <section>
          <h2>Elegí un nuevo horario</h2>
          {slots === null
            ? <p className="pub-note" role="status">Cargando horarios…</p>
            : <SlotPicker days={groupByDay(slots, DEFAULT_DAYS, rangeFrom)} selected={chosen?.starts_at} onSelect={setChosen} />}

          {chosen && (
            <p className="pub-note">Nuevo horario: <strong>{formatDateTime(chosen.starts_at)}</strong></p>
          )}
          <div className="pub-actions">
            <button type="button" className="pub-secondary" onClick={() => { setError(''); setMode('view'); }} disabled={busy}>Volver</button>
            {chosen && <button type="button" onClick={confirmReschedule} disabled={busy}>Confirmar reprogramación</button>}
          </div>
        </section>
      )}
    </main>
  );
}
