import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SlotPicker from './SlotPicker';
import { groupByDay } from '../domain/slots';
import type { Slot } from '../domain/publicTypes';

const slot = (d: number, h: number, m = 0): Slot => {
  const start = new Date(2030, 0, d, h, m);
  return { employee_id: 'usr-1', starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600000).toISOString() };
};
const FROM = new Date(2030, 0, 7, 8);

test('RF-15: deshabilita los días sin horarios y muestra los horarios del primer día con lugar', () => {
  const days = groupByDay([slot(8, 9), slot(8, 10)], 3, FROM); // día 7 vacío, 8 con lugar, 9 vacío
  render(<SlotPicker days={days} onSelect={() => {}} />);

  const dayButtons = screen.getAllByRole('button', { name: /(lun|mar|mié)/i });
  expect(dayButtons).toHaveLength(3);
  expect(dayButtons[0]).toBeDisabled();
  expect(dayButtons[1]).toBeEnabled();
  expect(dayButtons[2]).toBeDisabled();
  expect(screen.getByRole('button', { name: '09:00' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '10:00' })).toBeInTheDocument();
});

test('RF-15: elegir otro día cambia los horarios mostrados', async () => {
  const user = userEvent.setup();
  const days = groupByDay([slot(7, 9), slot(8, 15)], 2, FROM);
  render(<SlotPicker days={days} onSelect={() => {}} />);

  expect(screen.getByRole('button', { name: '09:00' })).toBeInTheDocument();
  await user.click(screen.getAllByRole('button', { name: /mar/i })[0]);
  expect(screen.getByRole('button', { name: '15:00' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '09:00' })).not.toBeInTheDocument();
});

test('emite el slot elegido', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const s = slot(7, 11);
  render(<SlotPicker days={groupByDay([s], 2, FROM)} onSelect={onSelect} />);

  await user.click(screen.getByRole('button', { name: '11:00' }));
  expect(onSelect).toHaveBeenCalledWith(s);
});

test('RF-17: sin ningún horario lo informa', () => {
  render(<SlotPicker days={groupByDay([], 14, FROM)} onSelect={() => {}} />);
  expect(screen.getByText(/no hay horarios disponibles/i)).toBeInTheDocument();
});

test('RF-34: se opera solo con teclado', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const s = slot(8, 9);
  render(<SlotPicker days={groupByDay([s], 3, FROM)} onSelect={onSelect} />);

  await user.tab(); // salta el día 7 (deshabilitado) y cae en el día 8
  expect(screen.getAllByRole('button', { name: /mar/i })[0]).toHaveFocus();
  await user.tab(); // primer horario
  expect(screen.getByRole('button', { name: '09:00' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(onSelect).toHaveBeenCalledWith(s);
});

test('marca como seleccionado el horario actual', () => {
  const s = slot(7, 9);
  render(<SlotPicker days={groupByDay([s], 2, FROM)} selected={s.starts_at} onSelect={() => {}} />);
  expect(screen.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'true');
});
