import { useId, useState } from 'react';
import { clientMatches, type NewClient } from '../domain/appointmentForm';
import type { Client } from '../domain/types';

export interface ClientValue {
  clientId: string; // '' = cliente nuevo
  newClient: NewClient;
}

interface Props {
  clients: Client[];
  value: ClientValue;
  onChange: (value: ClientValue) => void;
}

const MAX_SHOWN = 8;

// spec 010 RF-8 — elegir un cliente existente (búsqueda por nombre, email o teléfono) o ingresar uno nuevo.
export default function ClientPicker({ clients, value, onChange }: Props) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [query, setQuery] = useState('');
  const searchId = useId();
  const effective = clients.length === 0 ? 'new' : mode;

  const matches = clients.filter(c => clientMatches(c, query));
  const selected = clients.find(c => c.id === value.clientId);

  const field = (key: keyof NewClient) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ clientId: '', newClient: { ...value.newClient, [key]: e.target.value } });

  return (
    <fieldset className="pub-radios">
      <legend>Cliente</legend>
      {clients.length > 0 && (
        <div className="pub-actions">
          <button type="button" className="pub-chip" aria-pressed={effective === 'existing'} onClick={() => setMode('existing')}>Cliente existente</button>
          <button type="button" className="pub-chip" aria-pressed={effective === 'new'} onClick={() => { setMode('new'); onChange({ ...value, clientId: '' }); }}>Cliente nuevo</button>
        </div>
      )}

      {effective === 'existing' ? (
        <>
          <label htmlFor={searchId}>Buscar cliente</label>
          <input id={searchId} type="search" placeholder="Nombre, email o teléfono" value={query} onChange={e => setQuery(e.target.value)} />
          {selected && <p className="pub-note">Seleccionado: <strong>{selected.name}</strong></p>}
          {matches.length === 0 ? (
            <p className="pub-note">No hay clientes que coincidan.</p>
          ) : (
            <ul className="pub-list" aria-label="Clientes">
              {matches.slice(0, MAX_SHOWN).map(c => (
                <li key={c.id}>
                  <button type="button" className="pub-option" aria-pressed={c.id === value.clientId} onClick={() => onChange({ ...value, clientId: c.id })}>
                    {c.name}
                    <span className="pub-option-meta"> {c.email ?? c.phone ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {matches.length > MAX_SHOWN && <p className="pub-note">Hay más resultados: escribe más para acotar la búsqueda.</p>}
        </>
      ) : (
        <>
          <label>Nombre del cliente
            <input value={value.newClient.name} onChange={field('name')} autoComplete="off" />
          </label>
          <label>Email del cliente
            <input type="email" value={value.newClient.email} onChange={field('email')} autoComplete="off" />
          </label>
          <label>Teléfono del cliente
            <input type="tel" value={value.newClient.phone} onChange={field('phone')} autoComplete="off" />
          </label>
          <p className="pub-note">Indica al menos un email o un teléfono.</p>
        </>
      )}
    </fieldset>
  );
}
