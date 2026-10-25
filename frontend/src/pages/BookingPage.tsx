import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicService } from '../services/public';
import { ApiError } from '../services/api';
import SlotPicker from '../components/SlotPicker';
import ManageLinkBox from '../components/ManageLinkBox';
import AssistantChat from '../components/AssistantChat';
import { buildBookingPayload, manageLink, validateClient } from '../domain/booking';
import type { ClientErrors, ClientInput } from '../domain/booking';
import { publicErrorMessage } from '../domain/errors';
import { formatDateTime, formatPrice } from '../domain/format';
import { dedupeByStart, groupByDay, rangeFor, DEFAULT_DAYS } from '../domain/slots';
import type { BookingResult, PublicAccount, Slot } from '../domain/publicTypes';

type Step = 'service' | 'professional' | 'slot' | 'details' | 'confirm' | 'done';

const STEP_LABELS: { step: Exclude<Step, 'done'>; label: string }[] = [
  { step: 'service', label: 'Servicio' },
  { step: 'professional', label: 'Profesional' },
  { step: 'slot', label: 'Horario' },
  { step: 'details', label: 'Tus datos' },
  { step: 'confirm', label: 'Confirmación' },
];

const BACK: Partial<Record<Step, Step>> = { professional: 'service', slot: 'professional', details: 'slot', confirm: 'details' };

type Load =
  | { status: 'loading' }
  | { status: 'ready'; account: PublicAccount }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

const messageFor = (err: unknown) => publicErrorMessage(err instanceof ApiError ? err.message : undefined);

// Reserva pública (spec 005 RF-11..RF-22): asistente en una sola página, con el estado local.
export default function BookingPage() {
  const { accountId = '' } = useParams();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null); // null = "Cualquiera"
  const [slot, setSlot] = useState<Slot | null>(null);
  const [client, setClient] = useState<ClientInput>({ name: '', email: '', phone: '' });
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<ClientErrors>({});

  const [slots, setSlots] = useState<Slot[] | null>(null); // null = cargando
  const [slotsKey, setSlotsKey] = useState<string | null>(null);
  const [rangeFrom, setRangeFrom] = useState(() => new Date());

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [result, setResult] = useState<BookingResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    publicService.getAccount(accountId)
      .then(account => { if (!cancelled) setLoad({ status: 'ready', account }); })
      .catch(err => {
        if (cancelled) return;
        setLoad(err instanceof ApiError && err.status === 404 ? { status: 'not_found' } : { status: 'error', message: messageFor(err) });
      });
    return () => { cancelled = true; };
  }, [accountId]);

  if (load.status === 'loading') return <main className="pub-page"><p className="pub-note" role="status">Cargando…</p></main>;
  if (load.status === 'not_found') return <main className="pub-page"><h1>Negocio no encontrado</h1><p className="pub-note">Revisa el enlace que te compartieron.</p></main>;
  if (load.status === 'error') return <main className="pub-page"><p className="pub-error" role="alert">{load.message}</p></main>;

  const { account } = load;
  if (account.services.length === 0 || account.professionals.length === 0) {
    return (
      <main className="pub-page">
        <h1>{account.business_name}</h1>
        <p className="pub-note">Este negocio todavía no acepta reservas online.</p>
      </main>
    );
  }

  const service = account.services.find(s => s.id === serviceId) ?? null;
  const professional = account.professionals.find(p => p.id === employeeId) ?? null;

  function go(next: Step) {
    setError('');
    setStep(next);
  }

  // RF-15: una única solicitud para los próximos 14 días.
  async function fetchSlots(svcId: string, empId: string | null) {
    const from = new Date();
    const { date_from, date_to } = rangeFor(from);
    const list = await publicService.getSlots(accountId, { serviceId: svcId, employeeId: empId, dateFrom: date_from, dateTo: date_to });
    return { list, from };
  }

  async function goToSlots() {
    const key = `${serviceId}|${employeeId ?? ''}`;
    go('slot');
    if (key === slotsKey && slots) return;

    setSlot(null);
    setSlots(null);
    setSlotsKey(key);
    try {
      const { list, from } = await fetchSlots(serviceId!, employeeId);
      setRangeFrom(from);
      setSlots(list);
    } catch (err) {
      setSlots([]);
      setSlotsKey(null);
      setError(messageFor(err));
    }
  }

  function pickService(id: string) {
    if (id !== serviceId) setServiceId(id);
    go('professional');
  }

  function pickSlot(s: Slot) {
    setSlot(s);
    go('details');
  }

  function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    const found = validateClient(client);
    setErrors(found);
    if (Object.keys(found).length === 0) go('confirm');
  }

  async function confirm() {
    if (submittingRef.current || !service || !slot) return; // RF-19: sin reservas duplicadas
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const res = await publicService.book(buildBookingPayload({
        accountId, serviceId: service.id, scheduledAt: slot.starts_at, employeeId, client, notes,
      }));
      setResult(res);
      setStep('done');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // RF-21: el horario se ocupó; slots nuevos, de vuelta al paso de horario con los datos intactos.
        const msg = messageFor(err);
        setSlot(null);
        try {
          const { list, from } = await fetchSlots(service.id, employeeId);
          setRangeFrom(from);
          setSlots(list);
        } catch {
          setSlots([]);
          setSlotsKey(null);
        }
        setStep('slot');
        setError(msg);
      } else {
        setError(messageFor(err)); // RF-22: se queda en la confirmación y se puede reintentar
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const visibleSlots = slots ? (employeeId ? slots : dedupeByStart(slots)) : null;

  return (
    <main className="pub-page">
      <h1>{account.business_name}</h1>

      {step !== 'done' && (
        <ol className="pub-steps" aria-label="Pasos de la reserva">
          {STEP_LABELS.map(({ step: s, label }) => (
            <li key={s} aria-current={s === step ? 'step' : undefined}>{label}</li>
          ))}
        </ol>
      )}

      {error && <p className="pub-error" role="alert">{error}</p>}

      {step === 'service' && (
        <section>
          <h2>Elige un servicio</h2>
          <ul className="pub-list">
            {account.services.map(s => (
              <li key={s.id}>
                <button type="button" className="pub-option" aria-pressed={s.id === serviceId} onClick={() => pickService(s.id)}>
                  <span className="pub-option-name">{s.name}</span>
                  <span className="pub-option-meta">{s.duration_minutes} min · {formatPrice(s.price)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 'professional' && (
        <section>
          <h2>Elige un profesional</h2>
          <fieldset className="pub-radios">
            <legend className="pub-visually-hidden">Profesional</legend>
            <label>
              <input type="radio" name="professional" checked={employeeId === null} onChange={() => setEmployeeId(null)} />
              Cualquiera
            </label>
            {account.professionals.map(p => (
              <label key={p.id}>
                <input type="radio" name="professional" checked={employeeId === p.id} onChange={() => setEmployeeId(p.id)} />
                {p.name}
              </label>
            ))}
          </fieldset>
          <div className="pub-actions">
            <button type="button" className="pub-secondary" onClick={() => go(BACK.professional!)}>Volver</button>
            <button type="button" onClick={goToSlots}>Continuar</button>
          </div>
        </section>
      )}

      {step === 'slot' && (
        <section>
          <h2>Elige día y horario</h2>
          {visibleSlots === null
            ? <p className="pub-note" role="status">Cargando horarios…</p>
            : <SlotPicker days={groupByDay(visibleSlots, DEFAULT_DAYS, rangeFrom)} selected={slot?.starts_at} onSelect={pickSlot} />}
          <div className="pub-actions">
            <button type="button" className="pub-secondary" onClick={() => go(BACK.slot!)}>Volver</button>
            {slot && <button type="button" onClick={() => go('details')}>Continuar</button>}
          </div>
        </section>
      )}

      {step === 'details' && (
        <section>
          <h2>Tus datos</h2>
          <form onSubmit={submitDetails} noValidate className="pub-form">
            <label>
              Nombre
              <input value={client.name} onChange={e => setClient({ ...client, name: e.target.value })}
                autoComplete="name" aria-invalid={!!errors.name} />
              {errors.name && <span className="pub-field-error">{errors.name}</span>}
            </label>
            <label>
              Email
              <input type="email" value={client.email} onChange={e => setClient({ ...client, email: e.target.value })}
                autoComplete="email" aria-invalid={!!errors.email || !!errors.contact} />
              {errors.email && <span className="pub-field-error">{errors.email}</span>}
            </label>
            <label>
              Teléfono (formato internacional, ej. +5491155551234)
              <input type="tel" value={client.phone} onChange={e => setClient({ ...client, phone: e.target.value })}
                autoComplete="tel" aria-invalid={!!errors.phone || !!errors.contact} />
              {errors.phone && <span className="pub-field-error">{errors.phone}</span>}
            </label>
            {errors.contact && <p className="pub-field-error">{errors.contact}</p>}
            <label>
              Notas (opcional)
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
            </label>
            <div className="pub-actions">
              <button type="button" className="pub-secondary" onClick={() => go(BACK.details!)}>Volver</button>
              <button type="submit">Continuar</button>
            </div>
          </form>
        </section>
      )}

      {step === 'confirm' && service && slot && (
        <section>
          <h2>Confirma tu reserva</h2>
          <dl className="pub-summary">
            <dt>Servicio</dt><dd>{service.name} ({service.duration_minutes} min · {formatPrice(service.price)})</dd>
            <dt>Profesional</dt><dd>{professional ? professional.name : 'Cualquiera (te asignamos uno)'}</dd>
            <dt>Fecha y hora</dt><dd>{formatDateTime(slot.starts_at)}</dd>
            <dt>A nombre de</dt><dd>{client.name.trim()}</dd>
          </dl>
          <div className="pub-actions">
            <button type="button" className="pub-secondary" onClick={() => go(BACK.confirm!)} disabled={submitting}>Volver</button>
            <button type="button" onClick={confirm} disabled={submitting}>
              {submitting ? 'Reservando…' : 'Confirmar reserva'}
            </button>
          </div>
        </section>
      )}

      {step === 'done' && result && service && (
        <section>
          <h2>¡Turno reservado!</h2>
          <dl className="pub-summary">
            <dt>Servicio</dt><dd>{service.name}</dd>
            <dt>Profesional</dt>
            <dd>{account.professionals.find(p => p.id === result.appointment.assigned_user_id)?.name ?? 'A confirmar por el negocio'}</dd>
            <dt>Fecha y hora</dt><dd>{formatDateTime(result.appointment.scheduled_at)}</dd>
          </dl>
          <ManageLinkBox link={manageLink(window.location.origin, result.appointment.id, result.access_token)} />
        </section>
      )}

      {/* spec 011: alternativa conversacional al formulario. */}
      {step !== 'done' && <AssistantChat accountId={accountId} />}
    </main>
  );
}
