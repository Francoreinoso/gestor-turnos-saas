import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import AppNav from './AppNav';

const jwt = (role: string) => `h.${btoa(JSON.stringify({ id: 'u1', account_id: 'acc-1', role }))}.s`;

const renderNav = (role: string, path: string) => {
  localStorage.setItem('token', jwt(role));
  return render(
    <AuthProvider><MemoryRouter initialEntries={[path]}><AppNav /></MemoryRouter></AuthProvider>,
  );
};

test('RF-2, spec 010 RF-26: el owner ve Agenda, Pagos, Servicios y Equipo', () => {
  renderNav('owner', '/owner/agenda');
  const links = screen.getAllByRole('link').map(l => [l.textContent, l.getAttribute('href')]);
  expect(links).toEqual([['Agenda', '/owner/agenda'], ['Pagos', '/owner/pagos'], ['Servicios', '/owner/servicios'], ['Equipo', '/owner/equipo']]);
});

test('RF-2, spec 010 RF-26: el staff ve Agenda, Pagos y Mi horario', () => {
  renderNav('staff', '/staff/agenda');
  const links = screen.getAllByRole('link').map(l => [l.textContent, l.getAttribute('href')]);
  expect(links).toEqual([['Agenda', '/staff/agenda'], ['Pagos', '/staff/pagos'], ['Mi horario', '/staff/horario']]);
});

test('el enlace de la página actual tiene aria-current="page"', () => {
  renderNav('owner', '/owner/servicios');
  expect(screen.getByRole('link', { name: 'Servicios' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Agenda' })).not.toHaveAttribute('aria-current');
});

test('Equipo sigue marcado dentro del horario de un trabajador', () => {
  renderNav('owner', '/owner/equipo/abc/horario');
  expect(screen.getByRole('link', { name: 'Equipo' })).toHaveAttribute('aria-current', 'page');
});

test('"Salir" cierra la sesión', async () => {
  renderNav('owner', '/owner/agenda');
  await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
  expect(localStorage.getItem('token')).toBeNull();
});
