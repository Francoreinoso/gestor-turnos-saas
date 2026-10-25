// spec 011 T9 — rutas /assistant/* con un LLM falso: flujo completo, aislamiento por cuenta, límites y errores del
// proveedor (RF-1..RF-4, RF-8, RF-11, RF-12, RF-16, RF-18, RNF-1..RNF-3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { startApiServer, tokenFor } from '../helpers/apiServer.js';
import { createFakeLlm, text, toolUse } from '../helpers/fakeLlm.js';
import { LlmUnavailableError } from '../../src/infrastructure/integrations/llm/port.js';
import { encodeConversation } from '../../src/infrastructure/http/assistantConversation.js';
import { users, clients, services, availability, appointments, assistantProposals } from '../../db/schema.js';

// LLM intercambiable por test: cada test fija su guion con `script(...)`.
let current = createFakeLlm();
const llm = { send: (req) => current.send(req) };
const script = (steps) => { current = createFakeLlm(steps); return current; };
const sent = [];
const sms = { sendVerificationCode: async (msg) => { sent.push(msg); } };

let api;
let disabled;
before(async () => {
  await setupDb();
  api = await startApiServer({ assistant: { llm, sms } });
  disabled = await startApiServer();
});
after(async () => { await api.close(); await disabled.close(); await teardownDb(); });

const DAY = 24 * 60 * 60 * 1000;
const phone = () => `+569${crypto.randomInt(10_000_000, 99_999_999)}`;
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const seedBusiness = async (accountId) => {
  const [service] = await db.insert(services).values({ account_id: accountId, name: 'Corte', duration_minutes: 60, price: '1000' }).returning();
  const [pro] = await db.insert(users).values({
    account_id: accountId, name: 'Ana', email: `a-${crypto.randomUUID()}@test.com`, role: 'staff', password_hash: 'x',
  }).returning();
  await db.insert(availability).values(Array.from({ length: 7 }, (_, dow) => ({ user_id: pro.id, day_of_week: dow, start_time: '09:00:00', end_time: '18:00:00' })));
  return { service, pro };
};

// Abre una sesión real (código por el espía de SMS) y devuelve token y teléfono.
const login = async (accountId, p = phone()) => {
  const start = await api.call('POST', '/assistant/session', { account_id: accountId, phone: p });
  assert.equal(start.status, 202, start.text);
  const code = sent.at(-1).code;
  const verify = await api.call('POST', '/assistant/session/verify', { account_id: accountId, phone: p, code });
  assert.equal(verify.status, 200, verify.text);
  return { token: verify.body.token, phone: p };
};

const lastToolResult = (req) => JSON.parse(req.messages.at(-1).content.at(-1).content);
const say = (token, message, conversation) => api.call('POST', '/assistant/messages', { message, ...(conversation ? { conversation } : {}) }, token);

test('sin proveedor configurado, todo /assistant/* responde 503 y el resto funciona — RNF-2', async () => {
  for (const [method, path] of [['POST', '/assistant/session'], ['POST', '/assistant/session/verify'], ['POST', '/assistant/messages'], ['POST', `/assistant/proposals/${crypto.randomUUID()}/confirm`]]) {
    const res = await disabled.call(method, path, {});
    assert.deepEqual([res.status, res.body], [503, { error: 'assistant_unavailable' }], path);
  }
  assert.equal((await disabled.call('GET', '/health')).status, 200);
});

test('flujo completo: código, sesión, propuesta con slot real y confirmación idempotente — RF-1, RF-2, RF-8, RF-11, RF-12', () =>
  withAccount(async (account) => {
    const { service } = await seedBusiness(account.id);
    const tomorrow = day(new Date(Date.now() + DAY));
    const { token, phone: p } = await login(account.id);

    const fake = script([
      toolUse(['listar_servicios', {}, 't1']),
      (req) => toolUse(['ver_disponibilidad', { servicio_id: lastToolResult(req).servicios[0].servicio_id, desde: tomorrow, hasta: tomorrow }, 't2']),
      (req) => toolUse(['proponer_reserva', { servicio_id: service.id, slot_id: lastToolResult(req).horarios[0].slot_id }, 't3']),
      text('Te dejé la reserva lista: confírmala con el botón.'),
    ]);
    const res = await say(token, 'Quiero un corte mañana');

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.reply, 'Te dejé la reserva lista: confírmala con el botón.');
    assert.equal(res.body.proposals.length, 1);
    assert.equal(res.body.proposals[0].service, 'Corte');
    assert.equal(typeof res.body.conversation, 'string');
    assert.match(fake.requests[0].system[1].text, /Test/, 'el prompt lleva el nombre del negocio');
    assert.equal((await db.select().from(appointments).where(eq(appointments.account_id, account.id))).length, 0, 'sin turno hasta confirmar');

    const proposalId = res.body.proposals[0].id;
    const first = await api.call('POST', `/assistant/proposals/${proposalId}/confirm`, undefined, token);
    assert.equal(first.status, 201, first.text);
    assert.equal(first.body.appointment.status, 'agendado');
    assert.ok(first.body.access_token);
    const again = await api.call('POST', `/assistant/proposals/${proposalId}/confirm`, undefined, token);
    assert.equal(again.status, 200);
    assert.equal(again.body.appointment.id, first.body.appointment.id);

    const [appt] = await db.select().from(appointments).where(eq(appointments.account_id, account.id));
    const [client] = await db.select().from(clients).where(eq(clients.id, appt.client_id));
    assert.equal(client.phone, p, 'el turno queda a nombre del cliente de la sesión');

    // El segundo mensaje continúa la conversación firmada: el modelo recibe todo el historial anterior.
    const fake2 = script([text('¿Algo más?')]);
    const next = await say(token, 'gracias', res.body.conversation);
    assert.equal(next.status, 200, next.text);
    assert.equal(fake2.requests[0].messages.length, 8 + 1);
    assert.deepEqual(fake2.requests[0].messages.slice(0, 8), fake.requests[3].messages.concat([{ role: 'assistant', content: [{ type: 'text', text: 'Te dejé la reserva lista: confírmala con el botón.' }] }]));
  }));

test('conversación manipulada, de otra sesión o ilegible → 400 invalid_conversation sin llamar al modelo', () =>
  withAccount(async (account) => {
    await seedBusiness(account.id);
    const a = await login(account.id);
    const b = await login(account.id);
    script([text('hola')]);
    const { body } = await say(a.token, 'hola');

    const fake = script([]);
    const [h, p, s] = body.conversation.split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sid: 'x' })).toString('base64url')}.${s}`;
    for (const [token, conversation] of [[b.token, body.conversation], [a.token, tampered], [a.token, 'basura']]) {
      const res = await say(token, 'sigo', conversation);
      assert.deepEqual([res.status, res.body], [400, { error: 'invalid_conversation' }]);
    }
    assert.equal(fake.requests.length, 0);
  }));

test('tokens: uno del panel no abre /assistant y uno del asistente no abre el panel — principio 6', () =>
  withAccount(async (account) => {
    const [owner] = await db.insert(users).values({ account_id: account.id, name: 'O', email: `o-${crypto.randomUUID()}@test.com`, role: 'owner', password_hash: 'x' }).returning();
    const { token } = await login(account.id);

    assert.equal((await say(tokenFor(owner), 'hola')).status, 401);
    assert.equal((await say(undefined, 'hola')).status, 401);
    assert.equal((await api.call('GET', '/appointments', undefined, token)).status, 401);
    const forged = jwt.sign({ account_id: account.id, client_id: crypto.randomUUID(), sid: 'x' }, process.env.JWT_SECRET, { audience: 'assistant-session' });
    assert.equal((await say(forged, 'hola')).status, 401, 'firmado con la clave del panel');
  }));

test('aislamiento por cuenta: no se confirma ni se cancela nada de otra cuenta u otro cliente — RNF-1, RF-9, RF-12', () =>
  withAccount((accountA) => withAccount(async (accountB) => {
    const a = await seedBusiness(accountA.id);
    const b = await seedBusiness(accountB.id);
    const sessionA = await login(accountA.id);
    const sessionB = await login(accountB.id);
    const tomorrow = day(new Date(Date.now() + DAY));

    script([
      toolUse(['ver_disponibilidad', { servicio_id: a.service.id, desde: tomorrow, hasta: tomorrow }]),
      (req) => toolUse(['proponer_reserva', { servicio_id: a.service.id, slot_id: lastToolResult(req).horarios[0].slot_id }]),
      text('listo'),
    ]);
    const { body } = await say(sessionA.token, 'reserva');
    const proposalId = body.proposals[0].id;

    const otherAccount = await api.call('POST', `/assistant/proposals/${proposalId}/confirm`, undefined, sessionB.token);
    assert.deepEqual([otherAccount.status, otherAccount.body], [404, { error: 'not_found' }]);
    const otherClient = await login(accountA.id);
    assert.equal((await api.call('POST', `/assistant/proposals/${proposalId}/confirm`, undefined, otherClient.token)).status, 404);

    // Un turno de la cuenta B: desde la sesión de A el modelo no puede verlo ni cancelarlo, ni pasando ids propios.
    const [clientB] = await db.insert(clients).values({ account_id: accountB.id, name: 'B', phone: phone() }).returning();
    const start = new Date(Date.now() + 2 * DAY);
    const [apptB] = await db.insert(appointments).values({
      account_id: accountB.id, client_id: clientB.id, service_id: b.service.id, assigned_user_id: b.pro.id,
      scheduled_at: start, scheduled_until: new Date(start.getTime() + 3600000), status: 'agendado',
    }).returning();
    const fake = script([
      toolUse(['ver_mis_turnos', {}], ['cancelar_turno', { turno_id: apptB.id }], ['cancelar_turno', { turno_id: apptB.id, client_id: clientB.id }],
        ['ver_disponibilidad', { servicio_id: b.service.id, desde: tomorrow, hasta: tomorrow }]),
      text('No encontré ese turno.'),
    ]);
    await say(sessionA.token, 'cancela el turno ' + apptB.id);

    const [mine, cancel, withIds, foreignService] = fake.requests[1].messages.at(-1).content.map(r => ({ ...r, body: JSON.parse(r.content) }));
    assert.deepEqual(mine.body.turnos, []);
    assert.deepEqual([cancel.is_error, cancel.body.error], [true, 'not_found']);
    assert.deepEqual([withIds.is_error, withIds.body.error], [true, 'invalid_input']);
    assert.deepEqual([foreignService.is_error, foreignService.body.error], [true, 'service_not_found']);
    const [row] = await db.select().from(appointments).where(eq(appointments.id, apptB.id));
    assert.equal(row.status, 'agendado');
  })));

test('proveedor con 429/red/timeout/5xx → 503 assistant_busy sin detalle ni propuestas a medias — RF-18', () =>
  withAccount(async (account) => {
    const { service } = await seedBusiness(account.id);
    const { token } = await login(account.id);
    const tomorrow = day(new Date(Date.now() + DAY));
    const providerDetail = new Error('429 rate_limit_error: Number of requests exceeded, key sk-ant-xyz');

    script([
      toolUse(['ver_disponibilidad', { servicio_id: service.id, desde: tomorrow, hasta: tomorrow }]),
      (req) => toolUse(['proponer_reserva', { servicio_id: service.id, slot_id: lastToolResult(req).horarios[0].slot_id }]),
      new LlmUnavailableError('assistant_busy', { cause: providerDetail }),
    ]);
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    let res;
    try { res = await say(token, 'reserva mañana'); } finally { console.error = original; }

    assert.deepEqual([res.status, res.body], [503, { error: 'assistant_busy' }]);
    assert.doesNotMatch(res.text, /429|rate|sk-ant/);
    assert.ok(errors.every(e => !e.includes('sk-ant')), 'el log tampoco imprime la clave');
    const rows = await db.select().from(assistantProposals).where(eq(assistantProposals.account_id, account.id));
    assert.deepEqual(rows.map(r => r.status), ['descartada']);

    script([new LlmUnavailableError('assistant_unavailable')]);
    console.error = () => {};
    try { res = await say(token, 'hola'); } finally { console.error = original; }
    assert.deepEqual([res.status, res.body], [503, { error: 'assistant_unavailable' }]);
  }));

test('refusal o max_tokens → 200 con mensaje genérico — RF-16', () =>
  withAccount(async (account) => {
    const { token } = await login(account.id);
    for (const stopReason of ['refusal', 'max_tokens']) {
      script([{ content: [{ type: 'text', text: 'detalle interno' }], stopReason }]);
      const res = await say(token, 'algo');
      assert.equal(res.status, 200);
      assert.doesNotMatch(res.body.reply, /detalle interno/);
      assert.deepEqual(res.body.proposals, []);
    }
  }));

test('tope de mensajes por conversación → 429 conversation_limit — RF-4', () =>
  withAccount(async (account) => {
    const { token } = await login(account.id);
    const { sid, exp } = jwt.decode(token);
    const messages = Array.from({ length: 30 }, (_, i) => [
      { role: 'user', content: [{ type: 'text', text: `m${i}` }] }, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ]).flat();
    const fake = script([]);
    const res = await say(token, 'uno más', encodeConversation({ sid, exp, startedAt: new Date(), messages }));
    assert.deepEqual([res.status, res.body], [429, { error: 'conversation_limit' }]);
    assert.equal(fake.requests.length, 0);
  }));

test('límite por IP de solicitudes de código → 429 — RF-4', () =>
  withAccount(async (account) => {
    const ip = '203.0.113.77';
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await api.call('POST', '/assistant/session', { account_id: account.id, phone: phone() }, undefined, { ip })).status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(202));
    assert.equal(statuses[10], 429);
  }));

test('validación de entrada: teléfono, código y mensaje', () =>
  withAccount(async (account) => {
    const bad = await api.call('POST', '/assistant/session', { account_id: account.id, phone: '12345' });
    assert.deepEqual([bad.status, bad.body], [400, { error: 'invalid_phone_format' }]);
    const code = await api.call('POST', '/assistant/session/verify', { account_id: account.id, phone: phone(), code: '123456' });
    assert.deepEqual([code.status, code.body], [401, { error: 'invalid_code' }]);
    const { token } = await login(account.id);
    const empty = await say(token, '   ');
    assert.deepEqual([empty.status, empty.body], [400, { error: 'missing_fields' }]);
  }));
