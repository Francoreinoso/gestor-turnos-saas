import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { eq, and, inArray } from 'drizzle-orm';
import { setupDb, teardownDb, db } from '../helpers/db.js';
import * as schema from '../../db/schema.js';
import * as realRepos from '../../src/infrastructure/db/repositories/index.js';
import { listAvailableSlots } from '../../src/application/listAvailableSlots.js';
import { seedDemo, nextBusinessDay, DEMO_ACCOUNT_ID } from '../../db/seed.js';

// spec 006 D-P3: cada test usa un accountId y un emailPrefix propios para no pisar la demo real.
before(setupDb);

const created = [];
const run = async (overrides = {}) => {
  const accountId = overrides.accountId ?? randomUUID();
  const emailPrefix = overrides.emailPrefix ?? `t${accountId.slice(0, 8)}`;
  if (!created.includes(accountId)) created.push(accountId);
  return { accountId, emailPrefix, result: await seedDemo(db, { accountId, emailPrefix, env: {}, ...overrides }) };
};
after(async () => {
  for (const id of created) await db.delete(schema.accounts).where(eq(schema.accounts.id, id));
  await teardownDb();
});

const load = async (accountId) => {
  const [users, services, clients, appts] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.account_id, accountId)),
    db.select().from(schema.services).where(eq(schema.services.account_id, accountId)),
    db.select().from(schema.clients).where(eq(schema.clients.account_id, accountId)),
    db.select().from(schema.appointments).where(eq(schema.appointments.account_id, accountId)),
  ]);
  const payments = await db.select().from(schema.payments).where(eq(schema.payments.account_id, accountId));
  const availability = users.length
    ? await db.select().from(schema.availability).where(inArray(schema.availability.user_id, users.map(u => u.id)))
    : [];
  return { users, services, clients, appts, payments, availability };
};

test('el id fijo de la cuenta demo es el documentado', () => {
  assert.equal(DEMO_ACCOUNT_ID, '00000000-0000-4000-8000-000000000001');
});

test('RF-19: crea owner, 2 profesionales activos con comisiones distintas, 3 servicios y 4 clientes', async () => {
  const { accountId, result } = await run();
  const d = await load(accountId);

  assert.equal(result.accountId, accountId);
  assert.equal(d.users.filter(u => u.role === 'owner').length, 1);
  const staff = d.users.filter(u => u.role === 'staff');
  assert.equal(staff.length, 2);
  assert.ok(staff.every(u => u.status === 'activo'));
  assert.notEqual(Number(staff[0].commission_rate), Number(staff[1].commission_rate));
  for (const u of d.users) assert.ok(await bcrypt.compare('demo1234', u.password_hash));
  assert.equal(d.services.length, 3);
  assert.equal(d.clients.length, 4);

  const histories = await db.select().from(schema.servicePriceHistories)
    .where(inArray(schema.servicePriceHistories.service_id, d.services.map(s => s.id)));
  const perService = Object.groupBy(histories, h => h.service_id);
  assert.ok(Object.values(perService).some(rows => rows.length >= 2), 'un servicio con cambio de precio');
  assert.ok(d.services.every(s => perService[s.id]?.length >= 1));
});

test('RF-19/RF-20: turnos completados con pago coherente, agendados con token, bloqueo y cancelado', async () => {
  const { accountId } = await run();
  const d = await load(accountId);
  const by = (status) => d.appts.filter(a => a.status === status);

  const completed = by('completado');
  assert.ok(completed.length >= 6);
  const now = Date.now();
  assert.ok(completed.every(a => a.scheduled_until.getTime() < now && a.scheduled_at.getTime() > now - 14 * 86400000));
  for (const a of completed) {
    const p = d.payments.find(p => p.appointment_id === a.id);
    assert.ok(p, 'cada completado tiene pago');
    const prof = d.users.find(u => u.id === a.assigned_user_id);
    assert.equal(Number(p.commission_rate_applied), Number(prof.commission_rate));
    assert.equal((Number(p.employee_amount) + Number(p.business_amount)).toFixed(2), Number(p.amount).toFixed(2));
  }

  const scheduled = by('agendado');
  assert.ok(scheduled.length >= 4);
  const tokens = await db.select().from(schema.appointmentAccessTokens)
    .where(inArray(schema.appointmentAccessTokens.appointment_id, scheduled.map(a => a.id)));
  assert.equal(tokens.length, scheduled.length);

  const blocks = by('bloqueado');
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].scheduled_at.getTime() > now);
  assert.equal(by('cancelado').length, 1);
});

test('RF-28: los agendados caen en días hábiles, dentro de una ventana de su profesional, sin solaparse', async () => {
  const { accountId } = await run();
  const d = await load(accountId);
  const scheduled = d.appts.filter(a => a.status === 'agendado');
  const block = d.appts.find(a => a.status === 'bloqueado');
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  for (const a of scheduled) {
    assert.ok(a.scheduled_at.getTime() > Date.now());
    const dow = a.scheduled_at.getDay();
    assert.ok(dow >= 1 && dow <= 5, 'día hábil');
    const start = a.scheduled_at.getHours() * 60 + a.scheduled_at.getMinutes();
    const end = start + (a.scheduled_until - a.scheduled_at) / 60000;
    const fits = d.availability.some(w => w.user_id === a.assigned_user_id && w.day_of_week === dow
      && toMin(w.start_time) <= start && end <= toMin(w.end_time));
    assert.ok(fits, 'dentro de una ventana del profesional asignado');
  }
  const live = [...scheduled, block];
  for (const a of scheduled) {
    for (const b of live) {
      if (a.id === b.id) continue;
      if (b.assigned_user_id && b.assigned_user_id !== a.assigned_user_id) continue;
      assert.ok(!(a.scheduled_at < b.scheduled_until && b.scheduled_at < a.scheduled_until), 'sin solapamiento');
    }
  }
});

test('RF-19: horarios de lunes a viernes parcialmente solapados y "Cualquiera" ofrece slots', async () => {
  const { accountId } = await run();
  const d = await load(accountId);
  const staff = d.users.filter(u => u.role === 'staff');
  const win = (u) => d.availability.filter(w => w.user_id === u.id);
  for (const u of staff) assert.deepEqual([...new Set(win(u).map(w => w.day_of_week))].sort(), [1, 2, 3, 4, 5]);

  const service = d.services[0];
  const from = nextBusinessDay(new Date(), 1);
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  const slots = await listAvailableSlots(db, { businessId: accountId, serviceId: service.id, from, to }, realRepos);
  assert.ok(new Set(slots.map(s => s.employee_id)).size === 2, 'ambos profesionales ofrecen horarios');
});

test('RF-26: devuelve credenciales, enlace de reserva y enlace de gestión', async () => {
  const { accountId, emailPrefix, result } = await run();
  assert.equal(result.bookingPath, `/reservar/${accountId}`);
  assert.match(result.managePath, /^\/turno\/[0-9a-f-]{36}\?token=[\w-]+$/);
  assert.equal(result.owner.email, `${emailPrefix}.owner@example.com`);
  assert.equal(result.owner.password, 'demo1234');
  assert.equal(result.staff.length, 2);
});

test('RF-21: dos ejecuciones dejan una sola cuenta y no tocan las ajenas', async () => {
  const other = await db.insert(schema.accounts).values({ business_name: 'Ajena' }).returning().then(r => r[0]);
  created.push(other.id);
  const { accountId, emailPrefix } = await run();
  const first = (await load(accountId)).appts.map(a => a.id);
  await run({ accountId, emailPrefix });
  const rows = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
  assert.equal(rows.length, 1);
  const second = (await load(accountId)).appts.map(a => a.id);
  assert.ok(second.length > 0 && second.every(id => !first.includes(id)), 'se recreó');
  const [still] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, other.id));
  assert.equal(still.business_name, 'Ajena');
});

test('RF-22: ifMissing con la cuenta existente → skipped y nada cambia', async () => {
  const { accountId, emailPrefix } = await run();
  const before = (await load(accountId)).appts.map(a => a.id).sort();
  const result = await seedDemo(db, { accountId, emailPrefix, env: {}, ifMissing: true });
  assert.deepEqual(result, { skipped: true });
  assert.deepEqual((await load(accountId)).appts.map(a => a.id).sort(), before);
});

test('RF-22: ifMissing sin la cuenta → la crea', async () => {
  const { accountId } = await run({ ifMissing: true });
  assert.equal((await load(accountId)).users.length, 3);
});

test('RF-23: un fallo a mitad conserva la cuenta anterior intacta', async () => {
  const { accountId, emailPrefix } = await run();
  const before = await load(accountId);
  const failing = {
    ...realRepos,
    appointments: { ...realRepos.appointments, create: async () => { throw new Error('boom'); } },
  };
  await assert.rejects(seedDemo(db, { accountId, emailPrefix, env: {}, repos: failing }), /boom/);
  const after = await load(accountId);
  assert.deepEqual(after.appts.map(a => a.id).sort(), before.appts.map(a => a.id).sort());
  assert.deepEqual(after.users.map(u => u.id).sort(), before.users.map(u => u.id).sort());
});

test('RF-24: en producción se niega y no escribe nada', async () => {
  const accountId = randomUUID();
  created.push(accountId);
  await assert.rejects(seedDemo(db, { accountId, emailPrefix: 'prod', env: { NODE_ENV: 'production' } }), /production/);
  const rows = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
  assert.equal(rows.length, 0);
});

test('D-P4: borrar una cuenta con turnos y pagos funciona en cascada', async () => {
  const { accountId } = await run();
  assert.ok((await load(accountId)).payments.length > 0);
  await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId));
  const d = await load(accountId);
  assert.equal(d.appts.length + d.payments.length + d.users.length, 0);
});
