// spec 011 T4 — herramientas de lectura y ejecutor de tool_use (RF-5, RF-6, RF-7, RF-10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeToolCall, toolDefinitions, TOOLS } from '../../src/application/assistant/tools/index.js';
import { MAX_SLOTS } from '../../src/application/assistant/tools/verDisponibilidad.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const SERVICE = '33333333-3333-4333-8333-333333333333';
const PRO = '44444444-4444-4444-8444-444444444444';

const allWeek = (start = '09:00:00', end = '12:00:00') =>
  Array.from({ length: 7 }, (_, dow) => ({ day_of_week: dow, start_time: start, end_time: end }));

const makeRepos = ({ spy = {}, taken = [], appointments = [] } = {}) => ({
  services: {
    findAll: async (db, accountId, filters) => { spy.services = { accountId, filters }; return [
      { id: 's2', name: 'Tintura', duration_minutes: 90, price: '20000.00', account_id: accountId },
      { id: 's1', name: 'Barba', duration_minutes: 30, price: '5000.00', account_id: accountId },
    ]; },
    findActive: async (db, id, accountId) => (id === SERVICE ? { id, duration_minutes: 60, account_id: accountId } : undefined),
  },
  users: {
    findWithAvailability: async () => [{ id: PRO, availability: allWeek() }],
    findManyByAccount: async () => [{ id: PRO, name: 'Ana' }],
  },
  appointments: {
    findTakenSlots: async () => taken,
    findForList: async (db, args) => { spy.list = args; return appointments; },
  },
});

const ctx = (repos, extra = {}) => ({ db: {}, repos, accountId: ACCOUNT, clientId: CLIENT, now: new Date(2026, 9, 24, 8, 0), messages: [], ...extra });
const call = (name, input, id = 'tu_1') => ({ type: 'tool_use', id, name, input });
const parse = (result) => JSON.parse(result.content);

test('las definiciones son esquemas estrictos con todos los campos requeridos', () => {
  for (const def of toolDefinitions()) {
    assert.equal(def.input_schema.additionalProperties, false, def.name);
    assert.deepEqual([...def.input_schema.required].sort(), Object.keys(def.input_schema.properties).sort(), def.name);
    assert.ok(def.description.length > 20, def.name);
  }
  assert.deepEqual(TOOLS.slice(0, 3).map(t => t.name), ['listar_servicios', 'ver_disponibilidad', 'ver_mis_turnos']);
});

test('listar_servicios: activos de la cuenta de la sesión, ordenados, con duración y precio — RF-5', async () => {
  const spy = {};
  const result = await executeToolCall(call('listar_servicios', {}), ctx(makeRepos({ spy })));

  assert.equal(result.is_error, undefined);
  assert.equal(result.tool_use_id, 'tu_1');
  assert.deepEqual(spy.services, { accountId: ACCOUNT, filters: { active: true } });
  assert.deepEqual(parse(result).servicios, [
    { servicio_id: 's1', nombre: 'Barba', duracion_minutos: 30, precio: '5000.00' },
    { servicio_id: 's2', nombre: 'Tintura', duracion_minutos: 90, precio: '20000.00' },
  ]);
});

test('ver_disponibilidad: horarios libres con slot_id opaco y distinto en cada horario — RF-6', async () => {
  const taken = [{ assigned_user_id: PRO, scheduled_at: new Date(2026, 9, 25, 10, 0), scheduled_until: new Date(2026, 9, 25, 11, 0) }];
  const result = await executeToolCall(call('ver_disponibilidad', { servicio_id: SERVICE, desde: '2026-10-25', hasta: '2026-10-25' }), ctx(makeRepos({ taken })));
  const body = parse(result);

  assert.equal(body.servicio_id, SERVICE);
  assert.equal(body.hay_mas, false);
  assert.deepEqual(body.horarios.map(h => new Date(h.inicio).getTime()), [new Date(2026, 9, 25, 9).getTime(), new Date(2026, 9, 25, 11).getTime()]);
  assert.equal(new Set(body.horarios.map(h => h.slot_id)).size, 2);
  for (const h of body.horarios) {
    assert.match(h.slot_id, /^s_[0-9a-f]{12}$/);
    assert.equal(h.profesional, 'Ana');
    assert.equal(h.profesional_id, PRO);
    assert.equal(h.dia, 'domingo');
  }
});

test('ver_disponibilidad: recorta a MAX_SLOTS y avisa con hay_mas', async () => {
  const result = await executeToolCall(call('ver_disponibilidad', { servicio_id: SERVICE, desde: '2026-10-25', hasta: '2026-11-07' }), ctx(makeRepos()));
  const body = parse(result);
  assert.equal(body.horarios.length, MAX_SLOTS);
  assert.equal(body.hay_mas, true);
});

test('ver_disponibilidad: rango de más de 14 días o servicio ajeno → tool_result con is_error, sin consultar — RF-6, RF-10', async () => {
  const tooLong = await executeToolCall(call('ver_disponibilidad', { servicio_id: SERVICE, desde: '2026-10-25', hasta: '2026-11-08' }), ctx(makeRepos()));
  assert.equal(tooLong.is_error, true);
  assert.equal(parse(tooLong).error, 'range_too_long');

  const other = await executeToolCall(call('ver_disponibilidad', { servicio_id: '55555555-5555-4555-8555-555555555555', desde: '2026-10-25', hasta: '2026-10-25' }), ctx(makeRepos()));
  assert.equal(other.is_error, true);
  assert.equal(parse(other).error, 'service_not_found');
});

test('ver_mis_turnos: solo del cliente de la sesión, desde ahora, y sin datos de contacto — RF-7', async () => {
  const spy = {};
  const appointments = [{
    id: 'a1', status: 'agendado', scheduled_at: new Date(2026, 9, 26, 10), notes: 'privado',
    client: { id: CLIENT, name: 'Yo', email: 'yo@example.com', phone: '+569' }, service: { name: 'Corte' }, assignedUser: { id: PRO, name: 'Ana' },
  }];
  const c = ctx(makeRepos({ spy, appointments }));
  const result = await executeToolCall(call('ver_mis_turnos', {}), c);

  assert.deepEqual(spy.list.filters, { clientId: CLIENT, dateFrom: c.now });
  assert.equal(spy.list.accountId, ACCOUNT);
  assert.deepEqual(Object.keys(parse(result).turnos[0]).sort(), ['estado', 'inicio', 'profesional', 'servicio', 'turno_id']);
  assert.doesNotMatch(result.content, /@|privado|\+569/);
});

test('entrada inválida, JSON inválido o herramienta desconocida → is_error sin ejecutar — RF-10', async () => {
  const spy = {};
  const repos = makeRepos({ spy });

  const extra = await executeToolCall(call('listar_servicios', { account_id: ACCOUNT }), ctx(repos));
  assert.equal(extra.is_error, true);
  assert.equal(parse(extra).error, 'invalid_input');

  const badJson = await executeToolCall({ ...call('listar_servicios', null), invalid_json: true }, ctx(repos));
  assert.equal(badJson.is_error, true);
  assert.equal(parse(badJson).error, 'invalid_json');

  const unknown = await executeToolCall(call('borrar_todo', {}), ctx(repos));
  assert.equal(unknown.is_error, true);
  assert.equal(parse(unknown).error, 'unknown_tool');
  assert.equal(spy.services, undefined, 'no se ejecutó ninguna herramienta');
});

test('un nombre que solo difiere en mayúsculas se acepta', async () => {
  const result = await executeToolCall(call('Listar_Servicios', {}), ctx(makeRepos()));
  assert.equal(result.is_error, undefined);
});

test('un error inesperado (no 4xx) se propaga en vez de ocultarse como tool_result', async () => {
  const repos = makeRepos();
  repos.services.findAll = async () => { throw new Error('db caída'); };
  await assert.rejects(() => executeToolCall(call('listar_servicios', {}), ctx(repos)), /db caída/);
});
