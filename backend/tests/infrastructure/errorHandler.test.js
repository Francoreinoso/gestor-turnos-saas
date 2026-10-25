import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toResponse, createErrorHandler } from '../../src/infrastructure/http/middleware/errorHandler.js';

const appError = (status, message) => Object.assign(new Error(message), { status });
const SQL = 'Failed query: select "id", "password_hash" from "users" where "users"."id" = $1';

// spec 008 RF-3 — errores de aplicación
test('error de aplicación 4xx con código snake_case pasa tal cual', () => {
  assert.deepEqual(toResponse(appError(404, 'not_found')), { status: 404, body: { error: 'not_found' } });
  assert.deepEqual(toResponse(appError(409, 'appointment_overlap')), { status: 409, body: { error: 'appointment_overlap' } });
  assert.deepEqual(toResponse(appError(422, 'invalid_status_transition')), { status: 422, body: { error: 'invalid_status_transition' } });
});

test('4xx cuyo mensaje no es un código → su mismo estado con bad_request', () => {
  assert.deepEqual(toResponse(appError(400, 'Unexpected token } in JSON')), { status: 400, body: { error: 'bad_request' } });
  assert.deepEqual(toResponse(appError(403, 'No tienes permiso')), { status: 403, body: { error: 'bad_request' } });
  assert.deepEqual(toResponse(appError(400, '')), { status: 400, body: { error: 'bad_request' } });
});

test('errores del parser de body se traducen a un código fijo', () => {
  const lib = (type, status, message) => Object.assign(new Error(message), { type, status });
  assert.deepEqual(toResponse(lib('entity.parse.failed', 400, 'Unexpected end of JSON input')), { status: 400, body: { error: 'invalid_body' } });
  assert.deepEqual(toResponse(lib('entity.too.large', 413, 'request entity too large')), { status: 413, body: { error: 'payload_too_large' } });
  assert.deepEqual(toResponse(lib('charset.unsupported', 415, 'unsupported charset "UTF-16"')), { status: 415, body: { error: 'unsupported_media_type' } });
  assert.deepEqual(toResponse(lib('encoding.unsupported', 415, 'unsupported content encoding "x"')), { status: 415, body: { error: 'unsupported_media_type' } });
});

// RF-1 — nada interno llega al cliente
test('error sin estado o con 5xx → exactamente internal_error, sin importar el mensaje', () => {
  for (const err of [new Error(SQL), appError(500, SQL), appError(502, 'bad_gateway'), appError(undefined, 'not_found'), new TypeError('x is not a function')]) {
    assert.deepEqual(toResponse(err), { status: 500, body: { error: 'internal_error' } }, err.message);
  }
});

test('spec 011 RF-18: 503 con código pasa (asistente ocupado); 503 sin código → internal_error', () => {
  assert.deepEqual(toResponse(appError(503, 'assistant_busy')), { status: 503, body: { error: 'assistant_busy' } });
  assert.deepEqual(toResponse(appError(503, 'Rate limit exceeded for key sk-x')), { status: 500, body: { error: 'internal_error' } });
});

test('un estado fuera de 4xx/5xx nunca se usa como código HTTP', () => {
  assert.equal(toResponse(appError(200, 'ok')).status, 500);
  assert.equal(toResponse(appError(302, 'moved')).status, 500);
});

// RF-2 — registro en servidor sin datos sensibles
test('registra método, ruta sin query y traza; nunca cuerpo, cabeceras ni la query', () => {
  const logs = [];
  const handler = createErrorHandler({ log: (...args) => logs.push(args) });
  const res = { statusCode: null, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } };
  const req = {
    method: 'GET',
    path: '/public/appointments/abc',
    originalUrl: '/public/appointments/abc?token=SECRETO123',
    query: { token: 'SECRETO123' },
    headers: { authorization: 'Bearer SECRETO456' },
    body: { password: 'SECRETO789' },
  };

  handler(new Error(SQL), req, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'internal_error' });
  assert.equal(logs.length, 1);
  const logged = JSON.stringify(logs[0].map(a => (a instanceof Error ? a.stack : a)));
  assert.match(logged, /GET/);
  assert.match(logged, /\/public\/appointments\/abc/);
  assert.match(logged, /Failed query/); // la traza/mensaje queda en el servidor
  for (const secret of ['SECRETO123', 'SECRETO456', 'SECRETO789']) assert.ok(!logged.includes(secret), secret);
});

test('un error de aplicación 4xx no se registra como fallo del servidor', () => {
  const logs = [];
  const handler = createErrorHandler({ log: (...args) => logs.push(args) });
  const res = { status() { return this; }, json() { return this; } };
  handler(appError(404, 'not_found'), { method: 'GET', path: '/x' }, res, () => {});
  assert.equal(logs.length, 0);
});
