// spec 008 RF-11 — contraseña nueva: de 8 caracteres a 72 bytes UTF-8 (bcrypt trunca en 72 bytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parseInput } from '../../src/domain/validation.js';
import { newPassword } from '../../src/domain/schemas/common.js';
import { registerBody } from '../../src/domain/schemas/auth.js';
import { activateBody } from '../../src/domain/schemas/public.js';
import { editSelfBody } from '../../src/domain/schemas/staff.js';

const schema = z.object({ password: newPassword() });
const accepts = (password) => assert.equal(parseInput(schema, { password }).password, password);
const rejects = (data, message, status = 400) => assert.throws(() => parseInput(schema, data), { message, status }, JSON.stringify(data));

test('límites inferior y superior', () => {
  rejects({ password: 'a'.repeat(7) }, 'invalid_password');
  accepts('a'.repeat(8));
  accepts('a'.repeat(72));
  rejects({ password: 'a'.repeat(73) }, 'invalid_password');
});

test('el máximo se mide en bytes, no en caracteres', () => {
  accepts('é'.repeat(36)); // 36 caracteres = 72 bytes
  rejects({ password: 'é'.repeat(37) }, 'invalid_password'); // 37 caracteres = 74 bytes
  rejects({ password: 'あ'.repeat(25) }, 'invalid_password'); // 25 caracteres = 75 bytes (3 por carácter)
});

test('el mínimo se mide en caracteres: un emoji cuenta como uno, no como dos', () => {
  rejects({ password: '😀'.repeat(7) }, 'invalid_password'); // 7 caracteres (14 unidades UTF-16)
  accepts('😀'.repeat(8)); // 8 caracteres = 32 bytes
});

test('no recorta: 8 espacios son válidos y los espacios laterales se conservan', () => {
  accepts('        ');
  accepts('  clave12  ');
});

test('ausente o vacía → missing_fields; tipo incorrecto → invalid_body', () => {
  rejects({}, 'missing_fields');
  rejects({ password: '' }, 'missing_fields');
  rejects({ password: null }, 'missing_fields');
  rejects({ password: 12345678 }, 'invalid_body');
  rejects({ password: ['clave1234'] }, 'invalid_body');
});

// Los tres puntos de entrada (RF-11)
const NEW_USER = { business_name: 'B', name: 'A', email: 'a@b.com' };

test('registro: aplica la política', () => {
  assert.throws(() => parseInput(registerBody, { ...NEW_USER, password: 'corta' }), { message: 'invalid_password', status: 400 });
  assert.equal(parseInput(registerBody, { ...NEW_USER, password: 'larga-123' }).password, 'larga-123');
});

test('activación de trabajador: aplica la política', () => {
  assert.throws(() => parseInput(activateBody, { token: 't', password: 'corta' }), { message: 'invalid_password', status: 400 });
  assert.equal(parseInput(activateBody, { token: 't', password: 'larga-123' }).password, 'larga-123');
});

test('cambio propio (PATCH /me): longitud → invalid_password; tipo incorrecto sigue siendo invalid_field', () => {
  assert.throws(() => parseInput(editSelfBody, { password: 'corta' }), { message: 'invalid_password', status: 400 });
  assert.throws(() => parseInput(editSelfBody, { password: 12345678 }), { message: 'invalid_field', status: 400 });
  assert.equal(parseInput(editSelfBody, { password: 'larga-123' }).password, 'larga-123');
});
