// spec 011 T8 — sesión por teléfono: código de un solo uso, verificación y límites (RF-1..RF-4).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import * as repos from '../../src/infrastructure/db/repositories/index.js';
import { startSession, CODE_REQUESTS_PER_PHONE } from '../../src/application/assistant/startSession.js';
import { verifySession } from '../../src/application/assistant/verifySession.js';
import { clients, assistantCodes } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

const smsSpy = () => {
  const sent = [];
  return { sent, sendVerificationCode: async (msg) => { sent.push(msg); }, last: () => sent.at(-1).code };
};
const phone = () => `+569${crypto.randomInt(10_000_000, 99_999_999)}`;

test('pedir código: 6 dígitos por SMS, guardado como hash y respuesta idéntica exista o no el cliente — RF-1', () =>
  withAccount(async (account) => {
    const existing = phone();
    await db.insert(clients).values({ account_id: account.id, name: 'Ya existe', phone: existing });
    const sms = smsSpy();

    const a = await startSession(db, { accountId: account.id, phone: existing }, repos, sms);
    const b = await startSession(db, { accountId: account.id, phone: phone() }, repos, sms);

    assert.deepEqual(a, b);
    assert.match(sms.last(), /^\d{6}$/);
    assert.equal(sms.sent[0].to, existing);
    assert.equal(sms.sent[0].businessName, 'Test');
    const rows = await db.select().from(assistantCodes).where(eq(assistantCodes.account_id, account.id));
    assert.ok(rows.every(r => r.code_hash.length === 64 && !r.code_hash.includes(sms.sent[0].code)));
    assert.ok(rows.every(r => r.expires_at.getTime() - r.created_at.getTime() === 10 * 60 * 1000));
  }));

test('código correcto → identidad de la sesión; el cliente se crea por teléfono o se reutiliza — RF-2', () =>
  withAccount(async (account) => {
    const sms = smsSpy();
    const p = phone();

    await startSession(db, { accountId: account.id, phone: p }, repos, sms);
    const first = await verifySession(db, { accountId: account.id, phone: p, code: sms.last() }, repos);
    assert.equal(first.accountId, account.id);
    const [client] = await db.select().from(clients).where(eq(clients.id, first.clientId));
    assert.equal(client.phone, p);
    assert.equal(client.account_id, account.id);

    await startSession(db, { accountId: account.id, phone: p }, repos, sms);
    const second = await verifySession(db, { accountId: account.id, phone: p, code: sms.last() }, repos);
    assert.equal(second.clientId, first.clientId, 'mismo cliente');
  }));

test('código usado, vencido, de otra cuenta o reemplazado → 401 invalid_code — RF-3', () =>
  withAccount(async (account) => {
    const sms = smsSpy();
    const p = phone();
    const verify = (code, extra = {}) => verifySession(db, { accountId: account.id, phone: p, code, ...extra }, repos);

    await startSession(db, { accountId: account.id, phone: p }, repos, sms);
    const code = sms.last();
    await assert.rejects(() => verify(code, { now: new Date(Date.now() + 11 * 60 * 1000) }), { status: 401, message: 'invalid_code' });
    await assert.rejects(() => verify(code, { accountId: crypto.randomUUID() }), { status: 401, message: 'invalid_code' });
    await assert.rejects(() => verifySession(db, { accountId: account.id, phone: phone(), code }, repos), { status: 401, message: 'invalid_code' });
    await verify(code);
    await assert.rejects(() => verify(code), { status: 401, message: 'invalid_code' }, 'un solo uso');

    await startSession(db, { accountId: account.id, phone: p }, repos, sms);
    const old = sms.last();
    await startSession(db, { accountId: account.id, phone: p }, repos, sms);
    if (old !== sms.last()) await assert.rejects(() => verify(old), { status: 401, message: 'invalid_code' }, 'el nuevo invalida el anterior');
    await verify(sms.last());
  }));

test('tras 5 intentos fallidos el código se invalida, aunque después llegue el correcto — RF-3', () =>
  withAccount(async (account) => {
    const sms = smsSpy();
    const p = phone();
    await startSession(db, { accountId: account.id, phone: p }, repos, sms);
    const code = sms.last();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => verifySession(db, { accountId: account.id, phone: p, code: wrong }, repos), { status: 401, message: 'invalid_code' });
    }
    await assert.rejects(() => verifySession(db, { accountId: account.id, phone: p, code }, repos), { status: 401, message: 'invalid_code' });
  }));

test('dos verificaciones simultáneas del mismo código: solo una abre sesión — RF-3', () =>
  withAccount(async (account) => {
    const sms = smsSpy();
    const p = phone();
    await startSession(db, { accountId: account.id, phone: p }, repos, sms);
    const results = await Promise.allSettled([1, 2, 3].map(() => verifySession(db, { accountId: account.id, phone: p, code: sms.last() }, repos)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  }));

test(`límite por teléfono: más de ${CODE_REQUESTS_PER_PHONE} códigos en la ventana → 429 — RF-4`, () =>
  withAccount(async (account) => {
    const sms = smsSpy();
    const p = phone();
    for (let i = 0; i < CODE_REQUESTS_PER_PHONE; i++) await startSession(db, { accountId: account.id, phone: p }, repos, sms);
    await assert.rejects(() => startSession(db, { accountId: account.id, phone: p }, repos, sms), { status: 429, message: 'too_many_requests' });
    assert.equal(sms.sent.length, CODE_REQUESTS_PER_PHONE);
    await startSession(db, { accountId: account.id, phone: phone() }, repos, sms); // otro teléfono sigue pudiendo
  }));

test('cuenta inexistente → 404 not_found sin enviar nada', async () => {
  const sms = smsSpy();
  await assert.rejects(() => startSession(db, { accountId: crypto.randomUUID(), phone: phone() }, repos, sms), { status: 404, message: 'not_found' });
  assert.equal(sms.sent.length, 0);
});
