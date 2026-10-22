import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorNote from './ErrorNote';

test('RF-8: role="alert" con el mensaje mapeado del código', () => {
  render(<ErrorNote code="email_taken" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Ese email ya está en uso.');
});

test('RF-8: un código desconocido muestra el genérico, nunca el código', () => {
  render(<ErrorNote code="algo_raro" />);
  expect(screen.getByRole('alert')).not.toHaveTextContent('algo_raro');
});

test('un texto propio tiene prioridad y sin código ni texto no renderiza nada', () => {
  const { rerender, container } = render(<ErrorNote message="Texto propio" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Texto propio');
  rerender(<ErrorNote />);
  expect(container).toBeEmptyDOMElement();
});
