import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CopyLinkBox from './CopyLinkBox';

const LINK = 'http://localhost:5173/activar?token=abc';

test('RF-11: muestra el enlace, la etiqueta y el aviso configurable', () => {
  render(<CopyLinkBox link={LINK} label="Enlace de activación" notice="Entrégale este enlace al trabajador." />);
  expect(screen.getByLabelText('Enlace de activación')).toHaveValue(LINK);
  expect(screen.getByText('Entrégale este enlace al trabajador.')).toBeInTheDocument();
});

test('RF-11: "Copiar" usa el portapapeles y confirma', async () => {
  const user = userEvent.setup();
  render(<CopyLinkBox link={LINK} label="Enlace" notice="aviso" />);
  await user.click(screen.getByRole('button', { name: /copiar/i }));
  expect(await navigator.clipboard.readText()).toBe(LINK);
  expect(await screen.findByText(/copiado/i)).toBeInTheDocument();
});

test('RF-11: sin portapapeles el enlace sigue visible y se avisa', async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  render(<CopyLinkBox link={LINK} label="Enlace" notice="aviso" />);
  await user.click(screen.getByRole('button', { name: /copiar/i }));
  expect(screen.getByDisplayValue(LINK)).toBeInTheDocument();
  expect(await screen.findByText(/no pudimos copiar/i)).toBeInTheDocument();
});
