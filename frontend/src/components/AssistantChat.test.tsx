import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssistantChat from './AssistantChat';
import { assistantService } from '../services/assistant';
import { ApiError } from '../services/api';
import type { AssistantProposal } from '../domain/assistant';

vi.mock('../services/assistant', () => ({
  assistantService: { startSession: vi.fn(), verify: vi.fn(), sendMessage: vi.fn(), confirm: vi.fn() },
}));

const svc = vi.mocked(assistantService);

const tomorrowAt = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const PROPOSAL: AssistantProposal = {
  id: 'prop-1', service: 'Corte', professional: 'Ana', starts_at: tomorrowAt(10), expires_at: tomorrowAt(0),
};

beforeEach(() => {
  vi.resetAllMocks();
  svc.startSession.mockResolvedValue({ message: 'code_sent' });
  svc.verify.mockResolvedValue({ token: 'tok-sesion', expires_in: 3600 });
  svc.sendMessage.mockResolvedValue({ reply: 'Te preparé la reserva. Confírmala con el botón.', proposals: [PROPOSAL], conversation: 'conv-1' });
  svc.confirm.mockResolvedValue({
    proposal_id: 'prop-1', access_token: 'tok-gestion',
    appointment: { id: 'apt-1', scheduled_at: PROPOSAL.starts_at, scheduled_until: tomorrowAt(11), status: 'agendado' },
  });
});

async function openChat() {
  const user = userEvent.setup();
  render(<AssistantChat accountId="acc-1" />);
  await user.click(screen.getByRole('button', { name: 'Reservar con el asistente' }));
  await user.type(screen.getByLabelText(/Tu teléfono/), '+56911112222');
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
  await user.type(await screen.findByLabelText(/Código que te enviamos/), '123456');
  await user.click(screen.getByRole('button', { name: 'Verificar' }));
  await screen.findByLabelText('Tu mensaje');
  return user;
}

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText('Tu mensaje'), text);
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
}

test('verifica el teléfono con un código antes de conversar — RF-1, RF-2', async () => {
  await openChat();
  expect(svc.startSession).toHaveBeenCalledWith('acc-1', '+56911112222');
  expect(svc.verify).toHaveBeenCalledWith('acc-1', '+56911112222', '123456');
});

test('teléfono con formato inválido: no llama a la API', async () => {
  const user = userEvent.setup();
  render(<AssistantChat accountId="acc-1" />);
  await user.click(screen.getByRole('button', { name: 'Reservar con el asistente' }));
  await user.type(screen.getByLabelText(/Tu teléfono/), '911112222');
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
  expect(screen.getByRole('alert')).toHaveTextContent('formato internacional');
  expect(svc.startSession).not.toHaveBeenCalled();
});

test('código incorrecto → mensaje y sigue en el paso del código — RF-3', async () => {
  svc.verify.mockRejectedValue(new ApiError(401, 'invalid_code'));
  const user = userEvent.setup();
  render(<AssistantChat accountId="acc-1" />);
  await user.click(screen.getByRole('button', { name: 'Reservar con el asistente' }));
  await user.type(screen.getByLabelText(/Tu teléfono/), '+56911112222');
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
  await user.type(await screen.findByLabelText(/Código que te enviamos/), '000000');
  await user.click(screen.getByRole('button', { name: 'Verificar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('El código no es correcto');
  expect(screen.getByLabelText(/Código que te enviamos/)).toBeInTheDocument();
});

test('la respuesta muestra la propuesta y el turno solo existe al apretar Confirmar — RF-8, RF-11', async () => {
  const user = await openChat();
  await say(user, 'Quiero un corte mañana');

  expect(await screen.findByText('Te preparé la reserva. Confírmala con el botón.')).toBeInTheDocument();
  expect(svc.sendMessage).toHaveBeenCalledWith('tok-sesion', 'Quiero un corte mañana', null);
  expect(screen.getByText('Reserva pendiente de confirmación')).toBeInTheDocument();
  expect(svc.confirm).not.toHaveBeenCalled();

  const confirmBtn = screen.getByRole('button', { name: 'Confirmar' });
  await user.dblClick(confirmBtn);
  expect(await screen.findByText('¡Turno reservado!')).toBeInTheDocument();
  expect(svc.confirm).toHaveBeenCalledTimes(1);
  expect(svc.confirm).toHaveBeenCalledWith('tok-sesion', 'prop-1');
  expect((screen.getByLabelText('Enlace para gestionar tu turno') as HTMLInputElement).value).toContain('/turno/apt-1?token=tok-gestion');
});

test('el mensaje siguiente reenvía la conversación firmada que devolvió el servidor', async () => {
  const user = await openChat();
  await say(user, 'hola');
  await screen.findByText('Te preparé la reserva. Confírmala con el botón.');
  svc.sendMessage.mockResolvedValue({ reply: 'De nada', proposals: [], conversation: 'conv-2' });
  await say(user, 'gracias');
  await screen.findByText('De nada');
  expect(svc.sendMessage).toHaveBeenLastCalledWith('tok-sesion', 'gracias', 'conv-1');
});

test('horario tomado al confirmar → aviso y botón para pedir otras opciones al asistente — RF-13', async () => {
  svc.confirm.mockRejectedValue(new ApiError(409, 'appointment_overlap'));
  const user = await openChat();
  await say(user, 'reserva');
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }));

  const card = screen.getByText('Reserva pendiente de confirmación').parentElement!;
  expect(await within(card).findByRole('alert')).toHaveTextContent('Ese horario ya fue tomado');
  svc.sendMessage.mockResolvedValue({ reply: 'Tengo estas otras opciones…', proposals: [], conversation: 'conv-2' });
  await user.click(within(card).getByRole('button', { name: 'Pedir otras opciones' }));
  await screen.findByText('Tengo estas otras opciones…');
  expect(svc.sendMessage).toHaveBeenLastCalledWith('tok-sesion', 'El horario que elegí ya fue tomado. ¿Qué otras opciones tengo?', 'conv-1');
});

test('asistente ocupado (503) → mensaje genérico y el texto vuelve al campo para reintentar — RF-18', async () => {
  svc.sendMessage.mockRejectedValue(new ApiError(503, 'assistant_busy'));
  const user = await openChat();
  await say(user, 'hola');

  expect(await screen.findByRole('alert')).toHaveTextContent('Intenta de nuevo en unos minutos');
  expect(screen.getByLabelText('Tu mensaje')).toHaveValue('hola');
  expect(screen.queryByText('hola', { selector: 'li' })).not.toBeInTheDocument();
});

test('sesión vencida (401) → vuelve a pedir el teléfono', async () => {
  svc.sendMessage.mockRejectedValue(new ApiError(401, 'unauthorized'));
  const user = await openChat();
  await say(user, 'hola');
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu sesión con el asistente venció');
  expect(screen.getByLabelText(/Tu teléfono/)).toBeInTheDocument();
});

test('asistente no configurado → avisa que se puede usar el formulario — RNF-2', async () => {
  svc.startSession.mockRejectedValue(new ApiError(503, 'assistant_unavailable'));
  const user = userEvent.setup();
  render(<AssistantChat accountId="acc-1" />);
  await user.click(screen.getByRole('button', { name: 'Reservar con el asistente' }));
  await user.type(screen.getByLabelText(/Tu teléfono/), '+56911112222');
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Puedes reservar con el formulario'));
});
