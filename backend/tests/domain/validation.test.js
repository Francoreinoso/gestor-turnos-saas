import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { rule, parseInput } from '../../src/domain/validation.js';

const schema = z.object({
  a: z.string({ error: rule('code_a') }),
  b: z.number({ error: rule('code_b', 422) }),
});

test('rule: estado 400 por defecto y personalizable', () => {
  assert.equal(rule('x'), '400:x');
  assert.equal(rule('x', 422), '422:x');
});

test('parseInput devuelve los datos parseados y descarta claves desconocidas — RF-11', () => {
  assert.deepEqual(parseInput(schema, { a: 'x', b: 1, extra: true }), { a: 'x', b: 1 });
});

test('varios fallos → siempre el primero según el orden del esquema — RF-3', () => {
  for (let i = 0; i < 3; i++) {
    assert.throws(() => parseInput(schema, { a: 1, b: 'x' }), { message: 'code_a', status: 400 });
  }
  assert.throws(() => parseInput(schema, { a: 'x', b: 'x' }), { message: 'code_b', status: 422 });
});

test('cuerpo que no es objeto → 400 invalid_body — RF-10', () => {
  for (const body of [null, [], 'texto', undefined, 5]) {
    assert.throws(() => parseInput(schema, body), { message: 'invalid_body', status: 400 }, String(body));
  }
});

test('un issue sin regla propia → invalid_body y nunca el mensaje de la librería — RF-2', () => {
  const s = z.object({ n: z.number() });
  try { parseInput(s, { n: 'x' }); assert.fail('debía lanzar'); } catch (err) {
    assert.equal(err.message, 'invalid_body');
    assert.equal(err.status, 400);
    assert.equal(err.issues, undefined);
  }
});

test('los refinamientos cruzados no corren si falló el tipo de un campo', () => {
  let ran = false;
  const s = schema.refine(() => { ran = true; return false; }, rule('cross'));
  assert.throws(() => parseInput(s, { a: 1, b: 1 }), { message: 'code_a' });
  assert.equal(ran, false);
  assert.throws(() => parseInput(s, { a: 'x', b: 1 }), { message: 'cross' });
});

test('el error lleva status y message como espera errorHandler', () => {
  const err = (() => { try { parseInput(schema, { a: 'x', b: 'y' }); } catch (e) { return e; } })();
  assert.ok(err instanceof Error);
  assert.deepEqual({ status: err.status, message: err.message }, { status: 422, message: 'code_b' });
});
