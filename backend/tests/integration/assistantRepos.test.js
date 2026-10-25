// spec 011 T2 — migración 0007 y repos del asistente: propuestas pendientes y códigos de un solo uso.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { assistantProposalRepo } from '../../src/infrastructure/db/repositories/assistantProposals.js';
import { assistantCodeRepo } from '../../src/infrastructure/db/repositories/assistantCodes.js';
import { users, clients, services, appointments, assistantProposals, assistantCodes } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const seed = async (accountId) => {
  const [client] = await db.insert(clients).values({ account_id: accountId, name: 'Cliente', phone: `+569${crypto.randomInt(10_000_000, 99_999_999)}` }).returning();
  const [service] = await db.insert(services).values({ account_id: accountId, name: 'Corte', duration_minutes: 30, price: '1000' }).returning();
  const [employee] = await db.insert(users).values({
    account_id: accountId, name: 'Ana', email: `a-${crypto.randomUUID()}@test.com`, role: 'staff', password_hash: 'x',
  }).returning();
  return { client, service, employee };
};

const proposalData = (accountId, { client, service, employee }, startsAt) => ({
  account_id: accountId, client_id: client.id, service_id: service.id, employee_id: employee.id,
  starts_at: startsAt, expires_at: new Date(Date.now() + 10 * MINUTE),
});

// Drizzle envuelve el error de pg: el código SQLSTATE vive en err.cause.
const pgCode = (err) => err.cause?.code ?? err.code;

test('proponer dos veces el mismo horario devuelve la misma propuesta pendiente (índice único parcial)', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const startsAt = new Date(Date.now() + DAY);

    const first = await assistantProposalRepo.createPending(db, proposalData(account.id, s, startsAt));
    const second = await assistantProposalRepo.createPending(db, proposalData(account.id, s, startsAt));

    assert.equal(first.status, 'pendiente');
    assert.equal(second.id, first.id);
    await assert.rejects(
      db.insert(assistantProposals).values(proposalData(account.id, s, startsAt)),
      (err) => pgCode(err) === '23505',
      'la base rechaza una segunda pendiente igual',
    );
  }));

test('una propuesta no pendiente libera el horario para una propuesta nueva', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const startsAt = new Date(Date.now() + DAY);

    const first = await assistantProposalRepo.createPending(db, proposalData(account.id, s, startsAt));
    assert.ok(await assistantProposalRepo.markStatus(db, first.id, 'vencida'));
    const second = await assistantProposalRepo.createPending(db, proposalData(account.id, s, startsAt));

    assert.notEqual(second.id, first.id);
    assert.equal(await assistantProposalRepo.markStatus(db, first.id, 'descartada'), undefined, 'solo cambia una pendiente');
  }));

test('confirmada exige appointment_id (CHECK en la base)', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const proposal = await assistantProposalRepo.createPending(db, proposalData(account.id, s, new Date(Date.now() + DAY)));

    await assert.rejects(
      db.insert(assistantProposals).values({ ...proposalData(account.id, s, new Date(Date.now() + 2 * DAY)), status: 'confirmada' }),
      (err) => pgCode(err) === '23514',
    );

    const [appointment] = await db.insert(appointments).values({
      account_id: account.id, client_id: s.client.id, service_id: s.service.id, assigned_user_id: s.employee.id,
      scheduled_at: proposal.starts_at, scheduled_until: new Date(proposal.starts_at.getTime() + 30 * MINUTE), status: 'agendado',
    }).returning();
    const confirmed = await assistantProposalRepo.markConfirmed(db, proposal.id, appointment.id);
    assert.equal(confirmed.status, 'confirmada');
    assert.equal(confirmed.appointment_id, appointment.id);
    assert.equal(await assistantProposalRepo.markConfirmed(db, proposal.id, appointment.id), undefined, 'no se confirma dos veces');
  }));

test('findForClient: solo la propuesta del cliente y la cuenta indicados', () =>
  withAccount(async (account) => {
    const s = await seed(account.id);
    const proposal = await assistantProposalRepo.createPending(db, proposalData(account.id, s, new Date(Date.now() + DAY)));

    assert.ok(await assistantProposalRepo.findForClient(db, { id: proposal.id, accountId: account.id, clientId: s.client.id }));
    assert.equal(await assistantProposalRepo.findForClient(db, { id: proposal.id, accountId: account.id, clientId: crypto.randomUUID() }), undefined);
    assert.equal(await assistantProposalRepo.findForClient(db, { id: proposal.id, accountId: crypto.randomUUID(), clientId: s.client.id }), undefined);
  }));

const codeData = (accountId, phone, overrides = {}) => ({
  account_id: accountId, phone, code_hash: 'h'.repeat(64), expires_at: new Date(Date.now() + 10 * MINUTE), ...overrides,
});

test('códigos: el activo es el último sin usar ni vencer; pedir uno nuevo invalida los anteriores', () =>
  withAccount(async (account) => {
    const phone = '+56911112222';
    await assistantCodeRepo.create(db, codeData(account.id, phone, { expires_at: new Date(Date.now() - MINUTE) }));
    assert.equal(await assistantCodeRepo.findActive(db, { accountId: account.id, phone }), undefined, 'vencido no cuenta');

    const first = await assistantCodeRepo.create(db, codeData(account.id, phone));
    assert.equal((await assistantCodeRepo.findActive(db, { accountId: account.id, phone })).id, first.id);
    assert.equal(await assistantCodeRepo.findActive(db, { accountId: crypto.randomUUID(), phone }), undefined, 'otra cuenta');

    await assistantCodeRepo.invalidateActive(db, { accountId: account.id, phone });
    const second = await assistantCodeRepo.create(db, codeData(account.id, phone));
    assert.equal((await assistantCodeRepo.findActive(db, { accountId: account.id, phone })).id, second.id);
    assert.equal(await assistantCodeRepo.countSince(db, { accountId: account.id, phone, since: new Date(Date.now() - MINUTE) }), 3);
  }));

test('códigos: consumir es de un solo uso y cada fallo suma un intento hasta invalidarlo', () =>
  withAccount(async (account) => {
    const phone = '+56933334444';
    const code = await assistantCodeRepo.create(db, codeData(account.id, phone));

    for (let i = 1; i < 5; i++) {
      const after = await assistantCodeRepo.registerFailure(db, code.id, 5);
      assert.equal(after.attempts, i);
      assert.equal(after.used_at, null);
    }
    const last = await assistantCodeRepo.registerFailure(db, code.id, 5);
    assert.equal(last.attempts, 5);
    assert.ok(last.used_at, 'el quinto fallo invalida el código');
    assert.equal(await assistantCodeRepo.consume(db, code.id), undefined, 'invalidado no se consume');

    const other = await assistantCodeRepo.create(db, codeData(account.id, phone));
    assert.ok(await assistantCodeRepo.consume(db, other.id));
    assert.equal(await assistantCodeRepo.consume(db, other.id), undefined, 'segundo uso rechazado');
  }));

test('códigos: la base no admite más de 5 intentos', () =>
  withAccount(async (account) => {
    await assert.rejects(
      db.insert(assistantCodes).values(codeData(account.id, '+56955556666', { attempts: 6 })),
      (err) => pgCode(err) === '23514',
    );
  }));
