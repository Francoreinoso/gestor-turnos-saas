import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScheduleEditor from './ScheduleEditor';
import { emptyWeek } from '../domain/schedule';
import type { WeekDays, ScheduleError } from '../domain/schedule';

const noErrors = (): (ScheduleError | null)[] => Array(7).fill(null);
const monday = (): WeekDays => { const d = emptyWeek(); d[0] = [{ start: '09:00', end: '12:00' }]; return d; };

test('RF-15: muestra siete días de lunes a domingo, con etiquetas "Lunes · desde"/"hasta"', () => {
  render(<ScheduleEditor days={monday()} errors={noErrors()} onChange={() => {}} />);
  const names = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
  expect(names).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
  expect(screen.getByLabelText('Lunes · desde')).toHaveValue('09:00');
  expect(screen.getByLabelText('Lunes · hasta')).toHaveValue('12:00');
  expect(screen.getAllByText('Sin atención')).toHaveLength(6);
});

test('RF-16: agregar un tramo llama a onChange con el estado nuevo', async () => {
  const onChange = vi.fn();
  render(<ScheduleEditor days={emptyWeek()} errors={noErrors()} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Agregar tramo el martes' }));
  const next = onChange.mock.calls[0][0] as WeekDays;
  expect(next[1]).toEqual([{ start: '09:00', end: '18:00' }]);
  expect(next[0]).toEqual([]);
});

test('RF-16: quitar un tramo', async () => {
  const onChange = vi.fn();
  render(<ScheduleEditor days={monday()} errors={noErrors()} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Quitar tramo 1 del lunes' }));
  expect((onChange.mock.calls[0][0] as WeekDays)[0]).toEqual([]);
});

test('RF-16: cambiar una hora llama a onChange sin tocar lo demás', () => {
  const onChange = vi.fn();
  render(<ScheduleEditor days={monday()} errors={noErrors()} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Lunes · hasta'), { target: { value: '13:30' } });
  expect((onChange.mock.calls[0][0] as WeekDays)[0]).toEqual([{ start: '09:00', end: '13:30' }]);
});

test('un segundo tramo del día tiene etiquetas propias', () => {
  const days = monday();
  days[0].push({ start: '15:00', end: '18:00' });
  render(<ScheduleEditor days={days} errors={noErrors()} onChange={() => {}} />);
  expect(screen.getByLabelText('Lunes · tramo 2 · desde')).toHaveValue('15:00');
});

test('RF-17: el error de una fila se anuncia junto a su día', () => {
  const errors = noErrors();
  errors[2] = 'overlap';
  render(<ScheduleEditor days={emptyWeek()} errors={errors} onChange={() => {}} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(/se solapan/i);
  expect(screen.getByRole('region', { name: 'Miércoles' })).toContainElement(alert);
});
