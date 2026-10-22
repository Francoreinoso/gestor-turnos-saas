import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from './ConfirmDialog';

const setup = () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();
  render(<ConfirmDialog title="¿Desactivar el servicio?" confirmLabel="Desactivar" onConfirm={onConfirm} onCancel={onCancel}>Los turnos existentes no cambian.</ConfirmDialog>);
  return { onConfirm, onCancel, user };
};

test('RF-7: es un alertdialog con nombre y descripción accesibles', () => {
  setup();
  const dialog = screen.getByRole('alertdialog', { name: '¿Desactivar el servicio?' });
  expect(dialog).toHaveAccessibleDescription('Los turnos existentes no cambian.');
});

test('el foco inicial queda en "Cancelar"', () => {
  setup();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
});

test('Escape cancela', async () => {
  const { user, onCancel, onConfirm } = setup();
  await user.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('el botón de confirmar invoca el callback y "Cancelar" el otro', async () => {
  const { user, onCancel, onConfirm } = setup();
  await user.click(screen.getByRole('button', { name: 'Desactivar' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('Tab no sale del diálogo', async () => {
  const { user } = setup();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Desactivar' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Desactivar' })).toHaveFocus();
});
