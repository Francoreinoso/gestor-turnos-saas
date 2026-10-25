// spec 011 T2b, RF-19 — teléfono y email de clients son únicos por cuenta, no en toda la base.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import * as repos from '../../src/infrastructure/db/repositories/index.js';
import { startSession } from '../../src/application/assistant/startSession.js';
import { verifySession } from '../../src/application/assistant/verifySession.js';
import { clients } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

const phone = () => `+569${crypto.randomInt(10_000_000, 99_999_999)}`;
const email = () => `c-${crypto.randomUUID()}@example.com`;
const pgCode = (err) => err.cause?.code ?? err.code;

test('el mismo teléfono y email pueden ser clientes de dos cuentas; dentro de una cuenta, no', () =>
  withAccount((a) => withAccount(async (b) => {
    const p = phone();
    const e = email();
    await db.insert(clients).values({ account_id: a.id, name: 'Ana', phone: p, email: e });
    await db.insert(clients).values({ account_id: b.id, name: 'Ana', phone: p, email: e });

    await assert.rejects(db.insert(clients).values({ account_id: a.id, name: 'Otra', phone: p }), (err) => pgCode(err) === '23505');
    await assert.rejects(db.insert(clients).values({ account_id: a.id, name: 'Otra', email: e.toUpperCase() }), (err) => pgCode(err) === '23505',
      'el email se compara sin mayúsculas');
  })));

test('verificar el código de un teléfono que ya es cliente de otra cuenta crea su ficha en esta cuenta — RF-2, RF-19', () =>
  withAccount((a) => withAccount(async (b) => {
    const p = phone();
    const [inA] = await db.insert(clients).values({ account_id: a.id, name: 'Ana', phone: p }).returning();
    const sent = [];
    await startSession(db, { accountId: b.id, phone: p }, repos, { sendVerificationCode: async (m) => { sent.push(m); } });

    const { clientId } = await verifySession(db, { accountId: b.id, phone: p, code: sent[0].code }, repos);

    assert.notEqual(clientId, inA.id);
    const [inB] = await db.select().from(clients).where(eq(clients.id, clientId));
    assert.equal(inB.account_id, b.id);
  })));

test('findOrCreate: busca por email y después por teléfono dentro de la cuenta — RF-19', () =>
  withAccount(async (a) => {
    const p = phone();
    const [existing] = await db.insert(clients).values({ account_id: a.id, name: 'Ana', phone: p }).returning();

    // Reserva pública con un email nuevo y el teléfono de una ficha existente: reutiliza esa ficha en vez de chocar.
    const found = await repos.clients.findOrCreate(db, { accountId: a.id, email: email(), phone: p }, { account_id: a.id, name: 'Ana', phone: p });
    assert.equal(found.id, existing.id);

    const byEmail = await repos.clients.findOrCreate(db, { accountId: a.id, email: email() }, { account_id: a.id, name: 'Nueva', email: 'x@example.com' });
    assert.notEqual(byEmail.id, existing.id);
  }));

test('findOrCreate: altas simultáneas del mismo cliente terminan en una sola fila, sin error — RF-19', () =>
  withAccount(async (a) => {
    const p = phone();
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      repos.clients.findOrCreate(db, { accountId: a.id, phone: p }, { account_id: a.id, name: p, phone: p })));

    assert.equal(new Set(results.map((c) => c.id)).size, 1);
    assert.equal((await db.select().from(clients).where(eq(clients.account_id, a.id))).length, 1);
  }));
