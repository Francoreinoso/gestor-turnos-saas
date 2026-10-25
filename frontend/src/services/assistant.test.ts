import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { assistantService } from './assistant';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const call = (i = 0) => ({ url: fetchMock.mock.calls[i][0] as string, init: fetchMock.mock.calls[i][1] as RequestInit });
const headers = (i = 0) => call(i).init.headers as Record<string, string>;

test('sesión: pedir y verificar el código, sin JWT del panel', async () => {
  localStorage.setItem('token', 'jwt-del-panel');
  await assistantService.startSession('acc-1', '+56911112222');
  await assistantService.verify('acc-1', '+56911112222', '123456');

  expect(call(0).url).toBe('/api/assistant/session');
  expect(JSON.parse(call(0).init.body as string)).toEqual({ account_id: 'acc-1', phone: '+56911112222' });
  expect(call(1).url).toBe('/api/assistant/session/verify');
  expect(JSON.parse(call(1).init.body as string)).toEqual({ account_id: 'acc-1', phone: '+56911112222', code: '123456' });
  expect(headers(0).Authorization).toBeUndefined();
});

test('mensajes y confirmación llevan el token de sesión del asistente; la conversación solo si existe', async () => {
  localStorage.setItem('token', 'jwt-del-panel');
  await assistantService.sendMessage('tok-sesion', 'hola', null);
  await assistantService.sendMessage('tok-sesion', 'sigo', 'conv-1');
  await assistantService.confirm('tok-sesion', 'prop-1');

  expect(call(0).url).toBe('/api/assistant/messages');
  expect(headers(0).Authorization).toBe('Bearer tok-sesion');
  expect(JSON.parse(call(0).init.body as string)).toEqual({ message: 'hola' });
  expect(JSON.parse(call(1).init.body as string)).toEqual({ message: 'sigo', conversation: 'conv-1' });
  expect(call(2).url).toBe('/api/assistant/proposals/prop-1/confirm');
  expect(call(2).init.method).toBe('POST');
  expect(headers(2).Authorization).toBe('Bearer tok-sesion');
});
