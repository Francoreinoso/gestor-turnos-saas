import { test, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClientPicker, { type ClientValue } from './ClientPicker';
import type { Client } from '../domain/types';

const clients: Client[] = [
  { id: 'c1', account_id: 'a', name: 'José Núñez', email: 'jose@correo.cl', phone: null, notes: null },
  { id: 'c2', account_id: 'a', name: 'María Paz', email: null, phone: '+56911112222', notes: null },
];

const empty: ClientValue = { clientId: '', newClient: { name: '', email: '', phone: '' } };

function Harness({ list = clients, spy }: { list?: Client[]; spy?: (v: ClientValue) => void }) {
  const [value, setValue] = useState(empty);
  return <ClientPicker clients={list} value={value} onChange={v => { setValue(v); spy?.(v); }} />;
}

test('RF-8: filtra mientras se escribe, sin tildes ni mayúsculas', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Buscar cliente'), 'JOSE nun');
  expect(screen.getByRole('button', { name: /José Núñez/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /María Paz/ })).not.toBeInTheDocument();
});

test('RF-8: selecciona un cliente existente', async () => {
  const spy = vi.fn();
  render(<Harness spy={spy} />);
  await userEvent.click(screen.getByRole('button', { name: /María Paz/ }));
  expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 'c2' }));
  expect(screen.getByRole('button', { name: /María Paz/ })).toHaveAttribute('aria-pressed', 'true');
});

test('RF-8: alterna a "Cliente nuevo", limpia la selección y toma nombre, email y teléfono', async () => {
  const spy = vi.fn();
  render(<Harness spy={spy} />);
  await userEvent.click(screen.getByRole('button', { name: /José Núñez/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Cliente nuevo' }));
  expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: '' }));
  await userEvent.type(screen.getByLabelText('Nombre del cliente'), 'Ana');
  await userEvent.type(screen.getByLabelText('Teléfono del cliente'), '123');
  expect(spy).toHaveBeenLastCalledWith({ clientId: '', newClient: { name: 'Ana', email: '', phone: '123' } });
});

test('sin clientes registrados va directo al formulario de cliente nuevo', () => {
  render(<Harness list={[]} />);
  expect(screen.getByLabelText('Nombre del cliente')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cliente existente' })).not.toBeInTheDocument();
});

test('una búsqueda sin resultados lo dice', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Buscar cliente'), 'zzz');
  expect(screen.getByText('No hay clientes que coincidan.')).toBeInTheDocument();
});
