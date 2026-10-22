import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { userRepo } from '../../src/infrastructure/db/repositories/users.js';
import { availabilityRepo } from '../../src/infrastructure/db/repositories/availability.js';
import * as repos from '../../src/infrastructure/db/repositories/index.js';
import { getStaffAvailability } from '../../src/application/getStaffAvailability.js';
import { replaceStaffAvailability } from '../../src/application/replaceStaffAvailability.js';
import { findAvailableProfessional } from '../../src/application/findAvailableProfessional.js';
import { eq } from 'drizzle-orm';
import { users, clients, services } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

async function seedUser(accountId, { role = 'staff', status = 'activo' } = {}) {
  return db.insert(users).values({
    account_id: accountId,
    name: `${role}-${status}`,
    email: `u-${crypto.randomUUID()}@test.com`,
    role,
    status,
    password_hash: 'x',
  }).returning().then(r => r[0]);
}

const w = (day_of_week, start_time, end_time) => ({ day_of_week, start_time, end_time });

// T04 — availabilityRepo (RF-1, RF-3, RF-4)
test('availabilityRepo: replaceForUser reemplaza y findByUser ordena por día/inicio — RF-1, RF-3, RF-4', () =>
  withAccount(async (account) => {
    const user = await seedUser(account.id);

    await availabilityRepo.replaceForUser(db, user.id, [w(1, '09:00', '13:00')]);
    await availabilityRepo.replaceForUser(db, user.id, [w(3, '15:00', '19:00'), w(1, '09:00', '13:00'), w(3, '09:00', '13:00')]);

    const rows = await availabilityRepo.findByUser(db, user.id);
    assert.deepEqual(
      rows.map(r => [r.day_of_week, r.start_time.slice(0, 5), r.end_time.slice(0, 5)]),
      [[1, '09:00', '13:00'], [3, '09:00', '13:00'], [3, '15:00', '19:00']],
    );

    await availabilityRepo.replaceForUser(db, user.id, []); // RF-4
    assert.deepEqual(await availabilityRepo.findByUser(db, user.id), []);
  }));

test('availabilityRepo: replaceForUser no toca el horario de otro usuario', () =>
  withAccount(async (account) => {
    const a = await seedUser(account.id);
    const b = await seedUser(account.id);
    await availabilityRepo.replaceForUser(db, a.id, [w(1, '09:00', '13:00')]);
    await availabilityRepo.replaceForUser(db, b.id, [w(1, '09:00', '13:00')]); // mismas horas, otro usuario: válido
    await availabilityRepo.replaceForUser(db, b.id, []);
    assert.equal((await availabilityRepo.findByUser(db, a.id)).length, 1);
  }));

// T05 — findWithAvailability filtra rol y estado (RF-17, RF-18)
test('userRepo.findWithAvailability: solo staff activo; el reemplazo se refleja de inmediato — RF-17, RF-18', () =>
  withAccount(async (account) => {
    const activo = await seedUser(account.id);
    const pendiente = await seedUser(account.id, { status: 'pendiente' });
    const inactivo = await seedUser(account.id, { status: 'inactivo' });
    const owner = await seedUser(account.id, { role: 'owner' });
    for (const u of [activo, pendiente, inactivo, owner]) {
      await availabilityRepo.replaceForUser(db, u.id, [w(1, '09:00', '13:00')]);
    }

    let found = await userRepo.findWithAvailability(db, account.id);
    assert.deepEqual(found.map(u => u.id), [activo.id]);
    assert.equal(found[0].availability.length, 1);

    await availabilityRepo.replaceForUser(db, activo.id, [w(2, '10:00', '12:00')]);
    found = await userRepo.findWithAvailability(db, account.id);
    assert.equal(found[0].availability[0].day_of_week, 2); // RF-18

    // el filtro por id respeta el mismo criterio
    assert.deepEqual(await userRepo.findWithAvailability(db, account.id, owner.id), []);
  }));

const ownerActor = (u) => ({ id: u.id, role: 'owner' });
const staffActor = (u) => ({ id: u.id, role: 'staff' });
const put = (account, user, actor, body) =>
  replaceStaffAvailability(db, { id: user.id, accountId: account.id, actor, body }, repos);
const get = (account, user, actor) =>
  getStaffAvailability(db, { id: user.id, accountId: account.id, actor }, repos);

// T10 — atomicidad y EXCLUDE (RF-3, RF-9)
test('atomicidad: un reemplazo que falla a mitad deja intacto el horario anterior — RF-3', () =>
  withAccount(async (account) => {
    const user = await seedUser(account.id);
    await availabilityRepo.replaceForUser(db, user.id, [w(1, '09:00', '13:00')]);

    // salta el dominio a propósito: la 2ª ventana viola availability_start_before_end
    await assert.rejects(() => db.transaction(tx =>
      availabilityRepo.replaceForUser(tx, user.id, [w(2, '09:00', '13:00'), w(2, '18:00', '15:00')])));

    const rows = await availabilityRepo.findByUser(db, user.id);
    assert.deepEqual(rows.map(r => r.day_of_week), [1]);
  }));

test('EXCLUDE: ventanas solapadas del mismo usuario/día se rechazan; adyacentes no — RF-9', () =>
  withAccount(async (account) => {
    const user = await seedUser(account.id);
    await assert.rejects(
      () => availabilityRepo.replaceForUser(db, user.id, [w(1, '09:00', '13:00'), w(1, '12:00', '15:00')]),
      (err) => (err.cause?.code ?? err.code) === '23P01',
    );
    await availabilityRepo.replaceForUser(db, user.id, [w(1, '09:00', '13:00'), w(1, '13:00', '17:00')]);
    assert.equal((await availabilityRepo.findByUser(db, user.id)).length, 2);
  }));

test('CHECK: day_of_week fuera de 0..6 se rechaza en la base — RF-6', () =>
  withAccount(async (account) => {
    const user = await seedUser(account.id);
    await assert.rejects(
      () => availabilityRepo.replaceForUser(db, user.id, [w(7, '09:00', '13:00')]),
      (err) => (err.cause?.code ?? err.code) === '23514',
    );
  }));

test('el caso de uso traduce un solapamiento que escape del dominio a 422, no a 500 — D-P1', () =>
  withAccount(async (account) => {
    const user = await seedUser(account.id);
    const sneaky = { ...repos, availability: { ...repos.availability, replaceForUser: (tx, id) =>
      availabilityRepo.replaceForUser(tx, id, [w(1, '09:00', '13:00'), w(1, '12:00', '15:00')]) } };
    await assert.rejects(
      () => replaceStaffAvailability(db, { id: user.id, accountId: account.id, actor: ownerActor({ id: 'o' }), body: [w(1, '09:00', '10:00')] }, sneaky),
      { status: 422 },
    );
  }));

test('PUT → GET: orden, horas HH:MM y lista vacía — RF-1, RF-2, RF-4', () =>
  withAccount(async (account) => {
    const user = await seedUser(account.id);
    const owner = ownerActor({ id: 'o' });
    const saved = await put(account, user, owner, [w(3, '15:00', '19:00'), w(1, '09:00', '13:00')]);
    assert.deepEqual(saved, [w(1, '09:00', '13:00'), w(3, '15:00', '19:00')]);
    assert.deepEqual(await get(account, user, staffActor(user)), saved);

    assert.deepEqual(await put(account, user, owner, []), []);
    assert.deepEqual(await get(account, user, owner), []);
  }));

// T11 — alcance por rol end-to-end (RF-13..RF-16)
test('alcance por rol: todo lo fuera de alcance es 404, nunca 403 — RF-15, RF-16', () =>
  withAccount(async (account) => {
    const a = await seedUser(account.id);
    const b = await seedUser(account.id);
    const ownerUser = await seedUser(account.id, { role: 'owner' });
    const owner = ownerActor(ownerUser);
    const body = [w(1, '09:00', '13:00')];

    // owner sobre staff de su cuenta → ok
    assert.deepEqual(await put(account, a, owner, body), body);

    // staff sobre sí mismo → ok; sobre un compañero → 404
    assert.deepEqual(await put(account, a, staffActor(a), [w(2, '08:00', '12:00')]), [w(2, '08:00', '12:00')]);
    await assert.rejects(() => put(account, b, staffActor(a), body), { status: 404 });
    await assert.rejects(() => get(account, b, staffActor(a)), { status: 404 });

    // owner sobre su propio id (no es trabajador) → 404
    await assert.rejects(() => put(account, ownerUser, owner, body), { status: 404 });
    await assert.rejects(() => get(account, ownerUser, owner), { status: 404 });

    // usuario de otra cuenta → 404, incluso con cuerpo inválido (RF-10)
    await withAccount(async (other) => {
      const foreign = await seedUser(other.id);
      await assert.rejects(() => put(account, foreign, owner, 'basura'), { status: 404 });
      await assert.rejects(() => get(account, foreign, owner), { status: 404 });
    });
  }));

test('estado del trabajador: pendiente se configura, inactivo → 422 — RF-11', () =>
  withAccount(async (account) => {
    const pendiente = await seedUser(account.id, { status: 'pendiente' });
    const inactivo = await seedUser(account.id, { status: 'inactivo' });
    const owner = ownerActor({ id: 'o' });
    const body = [w(1, '09:00', '13:00')];

    assert.deepEqual(await put(account, pendiente, owner, body), body);
    await assert.rejects(() => put(account, inactivo, owner, body), { status: 422 });
  }));

// T12 — slots, autoasignación y turnos existentes (RF-12, RF-17)
test('findAvailableProfessional solo asigna al staff activo — RF-17', () =>
  withAccount(async (account) => {
    const activo = await seedUser(account.id);
    const others = [
      await seedUser(account.id, { status: 'pendiente' }),
      await seedUser(account.id, { status: 'inactivo' }),
      await seedUser(account.id, { role: 'owner' }),
    ];
    for (const u of [activo, ...others]) await availabilityRepo.replaceForUser(db, u.id, [w(1, '00:00', '23:59')]);

    // el lunes siguiente a mediodía (getDay() === 1 en hora local del servidor, como el código bajo prueba)
    const start = new Date();
    start.setDate(start.getDate() + ((8 - start.getDay()) % 7 || 7));
    start.setHours(12, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const found = await findAvailableProfessional(db, { accountId: account.id, scheduledAt: start, scheduledUntil: end }, repos);
    assert.equal(found.id, activo.id);

    await db.update(users).set({ status: 'inactivo' }).where(eq(users.id, activo.id));
    assert.equal(await findAvailableProfessional(db, { accountId: account.id, scheduledAt: start, scheduledUntil: end }, repos), null);
  }));

test('cambiar el horario no cancela ni mueve turnos agendados — RF-12', () =>
  withAccount(async (account) => {
    const user = await seedUser(account.id);
    const [client] = await db.insert(clients).values({ account_id: account.id, name: 'C', email: `c-${crypto.randomUUID()}@test.com` }).returning();
    const [service] = await db.insert(services).values({ account_id: account.id, name: 'S', duration_minutes: 60, price: '10.00' }).returning();
    const at = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const appt = await repos.appointments.create(db, {
      account_id: account.id, client_id: client.id, service_id: service.id, assigned_user_id: user.id,
      scheduled_at: at, scheduled_until: new Date(at.getTime() + 60 * 60 * 1000), status: 'agendado',
    });

    await put(account, user, ownerActor({ id: 'o' }), [w((at.getDay() + 1) % 7, '09:00', '10:00')]); // horario que no cubre el turno
    const after = await repos.appointments.findById(db, appt.id);
    assert.equal(after.status, 'agendado');
    assert.equal(after.scheduled_at.getTime(), at.getTime());
  }));

// T13 — concurrencia (RNF)
test('dos reemplazos simultáneos terminan sin error y gana exactamente uno — RNF concurrencia', () =>
  withAccount(async (account) => {
    const user = await seedUser(account.id);
    const owner = ownerActor({ id: 'o' });
    const A = [w(1, '09:00', '13:00'), w(2, '09:00', '13:00')];
    const B = [w(3, '10:00', '12:00')];

    await Promise.all(Array.from({ length: 5 }, (_, i) => put(account, user, owner, i % 2 ? B : A)));

    const final = await get(account, user, owner);
    assert.ok(
      JSON.stringify(final) === JSON.stringify(A) || JSON.stringify(final) === JSON.stringify(B),
      `horario mezclado: ${JSON.stringify(final)}`,
    );
  }));
