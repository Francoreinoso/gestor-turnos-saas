import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManageLinkBox from './ManageLinkBox';

const LINK = 'https://turnos.test/turno/abc?token=tok123';

test('RF-20: muestra el enlace completo y el aviso de guardarlo', () => {
  render(<ManageLinkBox link={LINK} />);
  expect(screen.getByDisplayValue(LINK)).toBeInTheDocument();
  expect(screen.getByText(/única forma de cancelar o reprogramar/i)).toBeInTheDocument();
  expect(screen.getByText(/guardá este enlace/i)).toBeInTheDocument();
});

test('RF-20: "Copiar" usa navigator.clipboard', async () => {
  const user = userEvent.setup(); // instala un portapapeles simulado
  render(<ManageLinkBox link={LINK} />);

  await user.click(screen.getByRole('button', { name: /copiar/i }));

  expect(await navigator.clipboard.readText()).toBe(LINK);
  expect(await screen.findByText(/copiado/i)).toBeInTheDocument();
});

test('RF-20: sin clipboard el enlace sigue visible y copiar no lanza', async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  render(<ManageLinkBox link={LINK} />);

  await user.click(screen.getByRole('button', { name: /copiar/i }));

  expect(screen.getByDisplayValue(LINK)).toBeInTheDocument();
  expect(await screen.findByText(/no pudimos copiar/i)).toBeInTheDocument();
});
