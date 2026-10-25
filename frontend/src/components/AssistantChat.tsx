import { useRef, useState } from 'react';
import { assistantService } from '../services/assistant';
import { ApiError } from '../services/api';
import ManageLinkBox from './ManageLinkBox';
import { manageLink } from '../domain/booking';
import { formatDateTime } from '../domain/format';
import {
  assistantErrorMessage, isValidCode, isValidPhone, OTHER_OPTIONS_MESSAGE,
} from '../domain/assistant';
import type { AssistantProposal, ConfirmedProposal } from '../domain/assistant';

type Stage = 'closed' | 'phone' | 'code' | 'chat';

type Item =
  | { kind: 'message'; role: 'user' | 'assistant'; text: string }
  | { kind: 'proposal'; proposal: AssistantProposal };

type ProposalState =
  | { status: 'pending' | 'confirming' }
  | { status: 'confirmed'; result: ConfirmedProposal }
  | { status: 'error'; code: string };

const codeOf = (err: unknown) => (err instanceof ApiError ? err.message : undefined);

// spec 011 — asistente conversacional de la página pública. El cliente verifica su teléfono con un código y conversa;
// el asistente propone reservas y el cliente las confirma con un botón (RF-11), sin pasar por el modelo.
// El token de sesión y la conversación firmada viven solo en la memoria del componente.
export default function AssistantChat({ accountId }: { accountId: string }) {
  const [stage, setStage] = useState<Stage>('closed');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [conversation, setConversation] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [proposals, setProposals] = useState<Record<string, ProposalState>>({});
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const confirmingRef = useRef(new Set<string>());

  // Evita dobles envíos (doble clic o Enter repetido).
  async function guarded(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try { await fn(); } finally { busyRef.current = false; setBusy(false); }
  }

  function restartSession(message: string) {
    setToken(null);
    setConversation(null);
    setCode('');
    setStage('phone');
    setError(message);
  }

  const requestCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPhone(phone)) { setError(assistantErrorMessage('invalid_phone_format')); return; }
    return guarded(async () => {
      try {
        await assistantService.startSession(accountId, phone.trim());
        setStage('code');
      } catch (err) {
        setError(assistantErrorMessage(codeOf(err)));
      }
    });
  };

  const verifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidCode(code)) { setError('El código tiene 6 dígitos.'); return; }
    return guarded(async () => {
      try {
        const res = await assistantService.verify(accountId, phone.trim(), code.trim());
        setToken(res.token);
        setStage('chat');
        setItems([{ kind: 'message', role: 'assistant', text: '¡Hola! Puedo mostrarte servicios y horarios, reservar o cancelar un turno. ¿Qué necesitas?' }]);
      } catch (err) {
        setError(assistantErrorMessage(codeOf(err)));
      }
    });
  };

  const send = (text: string) => guarded(async () => {
    const message = text.trim();
    if (!message || !token) return;
    setItems(prev => [...prev, { kind: 'message', role: 'user', text: message }]);
    setDraft('');
    try {
      const res = await assistantService.sendMessage(token, message, conversation);
      setConversation(res.conversation);
      setItems(prev => [
        ...prev,
        { kind: 'message', role: 'assistant', text: res.reply },
        ...res.proposals.map(proposal => ({ kind: 'proposal' as const, proposal })),
      ]);
      setProposals(prev => ({ ...prev, ...Object.fromEntries(res.proposals.map(p => [p.id, { status: 'pending' as const }])) }));
    } catch (err) {
      const errCode = codeOf(err);
      if (errCode === 'unauthorized') { restartSession(assistantErrorMessage(errCode)); return; }
      if (errCode === 'conversation_limit' || errCode === 'invalid_conversation') {
        setConversation(null);
        setItems([]);
      } else {
        setDraft(message); // el texto vuelve al campo para reintentar
        setItems(prev => prev.slice(0, -1));
      }
      setError(assistantErrorMessage(errCode));
    }
  });

  async function confirm(proposalId: string) {
    if (!token || confirmingRef.current.has(proposalId)) return;
    confirmingRef.current.add(proposalId);
    setProposals(prev => ({ ...prev, [proposalId]: { status: 'confirming' } }));
    try {
      const result = await assistantService.confirm(token, proposalId);
      setProposals(prev => ({ ...prev, [proposalId]: { status: 'confirmed', result } }));
    } catch (err) {
      const errCode = codeOf(err) ?? 'error';
      if (errCode === 'unauthorized') restartSession(assistantErrorMessage(errCode));
      setProposals(prev => ({ ...prev, [proposalId]: { status: 'error', code: errCode } }));
    } finally {
      confirmingRef.current.delete(proposalId);
    }
  }

  if (stage === 'closed') {
    return (
      <section className="assistant" aria-label="Asistente de reservas">
        <h2>¿Prefieres conversar?</h2>
        <p className="pub-note">Un asistente te muestra horarios y te prepara la reserva; tú la confirmas con un botón.</p>
        <button type="button" onClick={() => setStage('phone')}>Reservar con el asistente</button>
      </section>
    );
  }

  return (
    <section className="assistant" aria-label="Asistente de reservas">
      <h2>Asistente de reservas</h2>
      {error && <p className="pub-error" role="alert">{error}</p>}

      {stage === 'phone' && (
        <form onSubmit={requestCode} noValidate className="pub-form">
          <label>
            Tu teléfono (formato internacional, ej. +56912345678)
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
          </label>
          <p className="pub-note">Te enviaremos un código de 6 dígitos para identificarte.</p>
          <div className="pub-actions">
            <button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar código'}</button>
          </div>
        </form>
      )}

      {stage === 'code' && (
        <form onSubmit={verifyCode} noValidate className="pub-form">
          <label>
            Código que te enviamos a {phone.trim()}
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value)} />
          </label>
          <div className="pub-actions">
            <button type="button" className="pub-secondary" onClick={() => { setStage('phone'); setError(''); }} disabled={busy}>Cambiar teléfono</button>
            <button type="submit" disabled={busy}>{busy ? 'Verificando…' : 'Verificar'}</button>
          </div>
        </form>
      )}

      {stage === 'chat' && (
        <>
          <ol className="assistant-log" aria-live="polite" aria-label="Conversación">
            {items.map((item, i) => item.kind === 'message'
              ? <li key={i} className={`assistant-msg assistant-msg-${item.role}`}>
                  <span className="pub-visually-hidden">{item.role === 'user' ? 'Tú: ' : 'Asistente: '}</span>{item.text}
                </li>
              : <li key={i} className="assistant-proposal">
                  <ProposalCard proposal={item.proposal} state={proposals[item.proposal.id] ?? { status: 'pending' }}
                    onConfirm={() => confirm(item.proposal.id)} onOtherOptions={() => send(OTHER_OPTIONS_MESSAGE)} busy={busy} />
                </li>)}
            {busy && <li className="assistant-msg assistant-msg-assistant" role="status">Escribiendo…</li>}
          </ol>
          <form className="assistant-input" onSubmit={e => { e.preventDefault(); send(draft); }}>
            <label className="pub-visually-hidden" htmlFor="assistant-draft">Tu mensaje</label>
            <input id="assistant-draft" value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000} placeholder="Escribe tu mensaje" />
            <button type="submit" disabled={busy || !draft.trim()}>Enviar</button>
          </form>
        </>
      )}
    </section>
  );
}

function ProposalCard({ proposal, state, onConfirm, onOtherOptions, busy }: {
  proposal: AssistantProposal; state: ProposalState; onConfirm: () => void; onOtherOptions: () => void; busy: boolean;
}) {
  const summary = (
    <dl className="pub-summary">
      <dt>Servicio</dt><dd>{proposal.service}</dd>
      {proposal.professional && <><dt>Profesional</dt><dd>{proposal.professional}</dd></>}
      <dt>Fecha y hora</dt><dd>{formatDateTime(proposal.starts_at)}</dd>
    </dl>
  );

  if (state.status === 'confirmed') {
    const { appointment, access_token } = state.result;
    return (
      <div>
        <p className="pub-success" role="status">¡Turno reservado!</p>
        {summary}
        {access_token && <ManageLinkBox link={manageLink(window.location.origin, appointment.id, access_token)} />}
      </div>
    );
  }

  return (
    <div>
      <p className="assistant-proposal-title">Reserva pendiente de confirmación</p>
      {summary}
      {state.status === 'error' && <p className="pub-error" role="alert">{assistantErrorMessage(state.code)}</p>}
      <div className="pub-actions">
        {state.status === 'error' && state.code === 'appointment_overlap'
          ? <button type="button" onClick={onOtherOptions} disabled={busy}>Pedir otras opciones</button>
          : state.status !== 'error' && (
            <button type="button" onClick={onConfirm} disabled={state.status === 'confirming'}>
              {state.status === 'confirming' ? 'Confirmando…' : 'Confirmar'}
            </button>
          )}
      </div>
    </div>
  );
}
