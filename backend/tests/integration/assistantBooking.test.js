// spec 011 T5, T6 — proponer_reserva, confirmación idempotente y cancelar_turno contra Postgres (RF-8, RF-9, RF-11..RF-13).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import * as repos from '../../src/infrastructure/db/repositories/index.js';
import { executeToolCall } from '../../src/application/assistant/tools/index.js';
import { confirmProposal } from '../../src/application/assistant/confirmProposal.js';
import { users, clients, services, availability, appointments, assistantProposals } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

// Teléfonos aleatorios: los tests corren en paralelo sobre la misma base.
const phone = () => `+569${crypto.randomInt(10_000_000, 99_999_999)}`;
const DAY = 24 * 60 * 60 * 1000;

const seed = async (accountId) => {
  const [client, otherClient] = await db.insert(clients).values([
    { account_id: accountId, name: 'Yo', phone: phone() },
    { account_id: accountId, name: 'Otro', phone: phone() },
  ]).returning();
  const [service, otherService] = await db.insert(services).values([
    { account_id: accountId, name: 'Corte', duration_minutes: 60, price: '1000' },
    { account_id: accountId, name: 'Barba', duration_minutes: 30, price: '500' },
  ]).returning();
  const [pro] = await db.insert(users).values({
    account_id: accountId, name: 'Ana', email: `a-${crypto.randomUUID()}@test.com`, role: 'staff', password_hash: 'x',
  }).returning();
  await db.insert(availability).values(Array.from({ length: 7 }, (_, dow) => ({ user_id: pro.id, day_of_week: dow, start_time: '09:00:00', end_time: '18:00:00' })));
  return { client, otherClient, service, otherService, pro };
};

const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Conversación con un resultado real de ver_disponibilidad para mañana: devuelve historial y horarios emitidos.
const withAvailability = async (accountId, s) => {
  const ctx = { db, repos, accountId, clientId: s.client.id, now: new Date(), messages: [], proposals: [] };
  const tomorrow = new Date(Date.now() + DAY);
  const toolUse = { type: 'tool_use', id: 'tu_disp', name: 'ver_disponibilidad', input: { servicio_id: s.service.id, desde: day(tomorrow), hasta: day(tomorrow) } };
  const result = await executeToolCall(toolUse, ctx);
  ctx.messages.push({ role: 'assistant', content: [toolUse] }, { role: 'user', content: [result] });
  return { ctx, slots: JSON.parse(result.content).horarios };
};

const propose = (ctx, input) => executeToolCall({ type: 'tool_use', id: `tu_${crypto.randomUUID()}`, name: 'proponer_reserva', input }, ctx);
const body = (r) => JSON.parse(r.content);
const countAppointments = async (accountId) => (await db.select().from(appointments).where(eq(appointments.account_id, accountId))).length;

test('proponer_reserva crea una propuesta pendiente y NO crea el turno — RF-8', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const { ctx, slots } = await withAvailability(account.id, s);

    const r = await propose(ctx, { servicio_id: s.service.id, slot_id: slots[0].slot_id });

    assert.equal(r.is_error, undefined, r.content);
    assert.equal(body(r).estado, 'pendiente');
    const [row] = await db.select().from(assistantProposals).where(eq(assistantProposals.id, body(r).propuesta_id));
    assert.equal(row.client_id, s.client.id);
    assert.equal(row.account_id, account.id);
    assert.equal(row.employee_id, s.pro.id);
    assert.equal(row.starts_at.getTime(), new Date(slots[0].inicio).getTime());
    assert.equal(await countAppointments(account.id), 0);
    assert.equal(ctx.proposals.length, 1, 'la interfaz recibe la propuesta para mostrar el botón');
  }));

test('slot_id inventado, de otro servicio o de otra conversación → slot_invalid sin propuesta — RF-8', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const { ctx, slots } = await withAvailability(account.id, s);
    const fresh = { ...ctx, messages: [] };

    for (const [c, input] of [
      [ctx, { servicio_id: s.service.id, slot_id: 's_000000000000' }],
      [ctx, { servicio_id: s.otherService.id, slot_id: slots[0].slot_id }],
      [fresh, { servicio_id: s.service.id, slot_id: slots[0].slot_id }],
    ]) {
      const r = await propose(c, input);
      assert.equal(r.is_error, true);
      assert.equal(body(r).error, 'slot_invalid');
    }
    assert.equal((await db.select().from(assistantProposals).where(eq(assistantProposals.account_id, account.id))).length, 0);
  }));

test('confirmar crea el turno una sola vez: repetir devuelve el mismo, también en paralelo — RF-11, RF-12', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const { ctx, slots } = await withAvailability(account.id, s);
    const [p1, p2] = [body(await propose(ctx, { servicio_id: s.service.id, slot_id: slots[0].slot_id })),
      body(await propose(ctx, { servicio_id: s.service.id, slot_id: slots[2].slot_id }))];
    const args = (id) => ({ accountId: account.id, clientId: s.client.id, proposalId: id });

    const first = await confirmProposal(db, args(p1.propuesta_id), repos);
    assert.equal(first.created, true);
    assert.equal(first.appointment.status, 'agendado');
    assert.ok(first.access_token, 'enlace de gestión');
    const again = await confirmProposal(db, args(p1.propuesta_id), repos);
    assert.equal(again.created, false);
    assert.equal(again.appointment.id, first.appointment.id);
    assert.equal(again.access_token, undefined);

    const parallel = await Promise.all([1, 2, 3].map(() => confirmProposal(db, args(p2.propuesta_id), repos)));
    assert.equal(new Set(parallel.map(r => r.appointment.id)).size, 1);
    assert.equal(parallel.filter(r => r.created).length, 1);
    assert.equal(await countAppointments(account.id), 2);
  }));

test('confirmar una propuesta de otro cliente o de otra cuenta → 404 sin crear turno — RF-12', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const { ctx, slots } = await withAvailability(account.id, s);
    const p = body(await propose(ctx, { servicio_id: s.service.id, slot_id: slots[0].slot_id }));

    for (const args of [
      { accountId: account.id, clientId: s.otherClient.id, proposalId: p.propuesta_id },
      { accountId: crypto.randomUUID(), clientId: s.client.id, proposalId: p.propuesta_id },
      { accountId: account.id, clientId: s.client.id, proposalId: crypto.randomUUID() },
      { accountId: account.id, clientId: s.client.id, proposalId: 'no-uuid' },
    ]) {
      await assert.rejects(() => confirmProposal(db, args, repos), { status: 404, message: 'not_found' });
    }
    assert.equal(await countAppointments(account.id), 0);
  }));

test('confirmar una propuesta vencida → 409 proposal_expired y queda vencida — RF-12', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const { ctx, slots } = await withAvailability(account.id, s);
    const p = body(await propose(ctx, { servicio_id: s.service.id, slot_id: slots[0].slot_id }));
    const later = new Date(Date.now() + 11 * 60 * 1000);
    const args = { accountId: account.id, clientId: s.client.id, proposalId: p.propuesta_id, now: later };

    await assert.rejects(() => confirmProposal(db, args, repos), { status: 409, message: 'proposal_expired' });
    await assert.rejects(() => confirmProposal(db, { ...args, now: new Date() }, repos), { status: 409, message: 'proposal_expired' });
    const [row] = await db.select().from(assistantProposals).where(eq(assistantProposals.id, p.propuesta_id));
    assert.equal(row.status, 'vencida');
    assert.equal(await countAppointments(account.id), 0);
  }));

test('horario tomado al confirmar → 409 appointment_overlap, propuesta descartada — RF-13', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const { ctx, slots } = await withAvailability(account.id, s);
    const p = body(await propose(ctx, { servicio_id: s.service.id, slot_id: slots[0].slot_id }));
    const start = new Date(slots[0].inicio);
    await db.insert(appointments).values({
      account_id: account.id, client_id: s.otherClient.id, service_id: s.service.id, assigned_user_id: s.pro.id,
      scheduled_at: start, scheduled_until: new Date(start.getTime() + 60 * 60 * 1000), status: 'agendado',
    });
    const args = { accountId: account.id, clientId: s.client.id, proposalId: p.propuesta_id };

    await assert.rejects(() => confirmProposal(db, args, repos), { status: 409, message: 'appointment_overlap' });
    await assert.rejects(() => confirmProposal(db, args, repos), { status: 409, message: 'proposal_discarded' });
    assert.equal(await countAppointments(account.id), 1);

    // Al proponer de nuevo ese horario, el modelo recibe el error y puede ofrecer alternativas.
    const r = await propose(ctx, { servicio_id: s.service.id, slot_id: slots[0].slot_id });
    assert.equal(r.is_error, true);
    assert.equal(body(r).error, 'appointment_overlap');
  }));

test('cancelar_turno: cancela un turno propio; uno ajeno da not_found y queda intacto — RF-9', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const start = new Date(Date.now() + 2 * DAY);
    const book = (client, offsetH) => db.insert(appointments).values({
      account_id: account.id, client_id: client.id, service_id: s.service.id, assigned_user_id: s.pro.id,
      scheduled_at: new Date(start.getTime() + offsetH * 3600000), scheduled_until: new Date(start.getTime() + (offsetH + 1) * 3600000), status: 'agendado',
    }).returning().then(r => r[0]);
    const mine = await book(s.client, 0);
    const theirs = await book(s.otherClient, 2);
    const ctx = { db, repos, accountId: account.id, clientId: s.client.id, now: new Date(), messages: [], proposals: [] };
    const cancel = (id) => executeToolCall({ type: 'tool_use', id: 'tu_c', name: 'cancelar_turno', input: { turno_id: id } }, ctx);

    const ok = await cancel(mine.id);
    assert.equal(body(ok).estado, 'cancelado');

    const denied = await cancel(theirs.id);
    assert.equal(denied.is_error, true);
    assert.equal(body(denied).error, 'not_found');
    const [row] = await db.select().from(appointments).where(eq(appointments.id, theirs.id));
    assert.equal(row.status, 'agendado');

    const twice = await cancel(mine.id);
    assert.equal(body(twice).error, 'invalid_status_transition');
  }));
