import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { startPublicServer } from '../helpers/publicServer.js';
import * as repos from '../../src/infrastructure/db/repositories/index.js';
import { createAppointment } from '../../src/application/createAppointment.js';
import { createAppointmentFromPanel } from '../../src/application/createAppointmentFromPanel.js';
import { users, clients, services, availability, appointments } from '../../db/schema.js';

let api;
before(async () => { await setupDb(); api = await startPublicServer(); });
after(async () => { await api.close(); await teardownDb(); });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const uid = () => crypto.randomUUID();

const seedUser = async (accountId, { name = 'Prof', role = 'staff', status = 'activo', allDay = true } = {}) => {
  const user = await db.insert(users).values({
    account_id: accountId, name, role, status, email: `u-${uid()}@secreto.com`, password_hash: 'x', commission_rate: '0.3000',
  }).returning().then(r => r[0]);
  if (allDay) {
    await db.insert(availability).values(
      Array.from({ length: 7 }, (_, dow) => ({ user_id: user.id, day_of_week: dow, start_time: '00:00:00', end_time: '23:59:59' })),
    );
  }
  return user;
};

const seedService = (accountId, { name = 'Corte', active = true, duration = 60 } = {}) =>
  db.insert(services).values({ account_id: accountId, name, duration_minutes: duration, price: '1500.00', active }).returning().then(r => r[0]);

const CLIENT = { name: 'Cliente Privado', email: 'cliente-privado@example.com', phone: '+5491155551234' };

// Reserva real (caso de uso público) con enlace; `inMs` desde ahora.
const book = async (account, service, user, inMs) => {
  const scheduledAt = new Date(Date.now() + inMs);
  return createAppointment(db, {
    accountId: account.id, serviceId: service.id, scheduledAt, clientData: { ...CLIENT }, employeeId: user.id, notes: 'nota privada',
  }, repos);
};

// ─── RF-1, RF-2, RF-3 ────────────────────────────────────────────────────────

test('GET /public/accounts/:id no filtra datos: sin inactivos, sin owner, sin emails ni comisiones — RF-1, RF-2', () =>
  withAccount(async (account) => {
    await seedService(account.id, { name: 'Tintura' });
    await seedService(account.id, { name: 'Barba' });
    await seedService(account.id, { name: 'Servicio viejo', active: false });
    await seedUser(account.id, { name: 'Zoe' });
    await seedUser(account.id, { name: 'Ana' });
    await seedUser(account.id, { name: 'Pendiente', status: 'pendiente' });
    await seedUser(account.id, { name: 'Inactivo', status: 'inactivo' });
    await seedUser(account.id, { name: 'Dueña', role: 'owner' });

    const res = await api.get(`/public/accounts/${account.id}`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.services.map(s => s.name), ['Barba', 'Tintura']);
    assert.deepEqual(res.body.professionals.map(p => p.name), ['Ana', 'Zoe']);
    assert.equal(res.body.business_name, 'Test');
    assert.deepEqual(Object.keys(res.body.services[0]).sort(), ['duration_minutes', 'id', 'name', 'price']);
    assert.deepEqual(Object.keys(res.body.professionals[0]).sort(), ['id', 'name']);
    assert.doesNotMatch(res.text, /@|commission|password|secreto/i);
  }));

test('GET /public/accounts/:id sin servicios ni profesionales → 200 con listas vacías — RF-4', () =>
  withAccount(async (account) => {
    const res = await api.get(`/public/accounts/${account.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.services, []);
    assert.deepEqual(res.body.professionals, []);
  }));

test('GET /public/accounts/:id con id no UUID o inexistente → 404 not_found, nunca 500 — RF-3', async () => {
  for (const id of ['no-es-uuid', '123', uid()]) {
    const res = await api.get(`/public/accounts/${id}`);
    assert.equal(res.status, 404, id);
    assert.deepEqual(res.body, { error: 'not_found' });
  }
});

// ─── RF-5, RF-6, RF-7 ────────────────────────────────────────────────────────

test('GET /public/appointments/:id con token correcto → 200 sin datos del cliente — RF-5, RF-6', () =>
  withAccount(async (account) => {
    const service = await seedService(account.id);
    const pro = await seedUser(account.id, { name: 'Ana' });
    const { appointment, access_token } = await book(account, service, pro, 5 * DAY);

    const res = await api.get(`/public/appointments/${appointment.id}?token=${access_token}`);

    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(),
      ['account_id', 'business_name', 'id', 'professional', 'scheduled_at', 'scheduled_until', 'service', 'status']);
    assert.equal(res.body.status, 'agendado');
    assert.equal(res.body.account_id, account.id);
    assert.equal(res.body.business_name, 'Test');
    assert.deepEqual(res.body.professional, { id: pro.id, name: 'Ana' });
    assert.equal(res.body.service.name, 'Corte');
    assert.doesNotMatch(res.text, /@|\+549|nota privada|Cliente Privado/);
  }));

test('GET /public/appointments/:id: sin token, token incorrecto o de otro turno → 401 unauthorized — RF-7', () =>
  withAccount(async (account) => {
    const service = await seedService(account.id);
    const pro = await seedUser(account.id);
    const a = await book(account, service, pro, 5 * DAY);
    const b = await book(account, service, pro, 6 * DAY);

    for (const qs of ['', '?token=', '?token=incorrecto', `?token=${b.access_token}`, `?token=${a.access_token}&token=${a.access_token}`]) {
      const res = await api.get(`/public/appointments/${a.appointment.id}${qs}`);
      assert.equal(res.status, 401, qs);
      assert.deepEqual(res.body, { error: 'unauthorized' });
    }
  }));

test('GET /public/appointments/:id con token vencido → 401 token_expired — RF-7', () =>
  withAccount(async (account) => {
    const service = await seedService(account.id);
    const pro = await seedUser(account.id);
    // Empieza en 1 h: el enlace vence 2 h antes → ya venció.
    const { appointment, access_token } = await book(account, service, pro, 1 * HOUR);

    const res = await api.get(`/public/appointments/${appointment.id}?token=${access_token}`);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'token_expired' });
  }));

test('turno inexistente o id no UUID → 401 (no 404 ni 500), también al cancelar y reprogramar — RF-7', async () => {
  for (const id of [uid(), 'no-es-uuid']) {
    const g = await api.get(`/public/appointments/${id}?token=abc`);
    const c = await api.patch(`/public/appointments/${id}/cancel?token=abc`);
    const r = await api.patch(`/public/appointments/${id}/reschedule?token=abc`, { scheduled_at: new Date(Date.now() + DAY).toISOString() });
    for (const res of [g, c, r]) {
      assert.equal(res.status, 401, id);
      assert.deepEqual(res.body, { error: 'unauthorized' });
    }
  }
});

// ─── RF-9, RF-10, RF-10b, D4 ─────────────────────────────────────────────────

test('reserva pública con inicio pasado → 422 appointment_in_past y no crea fila — RF-10', () =>
  withAccount(async (account) => {
    const service = await seedService(account.id);
    const pro = await seedUser(account.id);

    const res = await api.post('/public/bookings', {
      account_id: account.id, service_id: service.id, employee_id: pro.id, client: CLIENT,
      scheduled_at: new Date(Date.now() - HOUR).toISOString(),
    });

    assert.equal(res.status, 422);
    assert.deepEqual(res.body, { error: 'appointment_in_past' });
    assert.deepEqual(await db.select().from(appointments).where(eq(appointments.account_id, account.id)), []);
    assert.deepEqual(await db.select().from(clients).where(eq(clients.account_id, account.id)), []);
  }));

test('reserva pública con scheduled_at inválido → 400 invalid_scheduled_at, no 500 — RF-10b', () =>
  withAccount(async (account) => {
    const service = await seedService(account.id);
    const pro = await seedUser(account.id);

    for (const bad of ['x', '2030-13-45', 12345]) {
      const res = await api.post('/public/bookings', {
        account_id: account.id, service_id: service.id, employee_id: pro.id, client: CLIENT, scheduled_at: bad,
      });
      assert.equal(res.status, 400, String(bad));
      assert.deepEqual(res.body, { error: 'invalid_scheduled_at' });
    }
    assert.deepEqual(await db.select().from(appointments).where(eq(appointments.account_id, account.id)), []);
  }));

test('reserva pública a futuro → 201 con enlace; al reprogramar el turno viejo queda cancelado y el nuevo enlace da el turno nuevo — RF-28', () =>
  withAccount(async (account) => {
    const service = await seedService(account.id);
    const pro = await seedUser(account.id);

    const created = await api.post('/public/bookings', {
      account_id: account.id, service_id: service.id, employee_id: pro.id, client: CLIENT,
      scheduled_at: new Date(Date.now() + 5 * DAY).toISOString(),
    });
    assert.equal(created.status, 201);
    const { appointment, access_token } = created.body;

    const moved = await api.patch(`/public/appointments/${appointment.id}/reschedule?token=${access_token}`, {
      scheduled_at: new Date(Date.now() + 6 * DAY).toISOString(),
    });
    assert.equal(moved.status, 201);
    assert.notEqual(moved.body.appointment.id, appointment.id);

    const old = await api.get(`/public/appointments/${appointment.id}?token=${access_token}`);
    assert.equal(old.status, 200);
    assert.equal(old.body.status, 'cancelado');
    const fresh = await api.get(`/public/appointments/${moved.body.appointment.id}?token=${moved.body.access_token}`);
    assert.equal(fresh.body.status, 'agendado');
  }));

test('reprogramar al pasado → 422 y el turno original sigue agendado — RF-10', () =>
  withAccount(async (account) => {
    const service = await seedService(account.id);
    const pro = await seedUser(account.id);
    const { appointment, access_token } = await book(account, service, pro, 5 * DAY);

    const res = await api.patch(`/public/appointments/${appointment.id}/reschedule?token=${access_token}`, {
      scheduled_at: new Date(Date.now() - HOUR).toISOString(),
    });
    assert.equal(res.status, 422);
    assert.deepEqual(res.body, { error: 'appointment_in_past' });

    const bad = await api.patch(`/public/appointments/${appointment.id}/reschedule?token=${access_token}`, { scheduled_at: 'x' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body, { error: 'invalid_scheduled_at' });

    const [after] = await db.select().from(appointments).where(eq(appointments.id, appointment.id));
    assert.equal(after.status, 'agendado');
    const all = await db.select().from(appointments).where(eq(appointments.account_id, account.id));
    assert.equal(all.length, 1);
  }));

test('el panel sigue pudiendo cargar un turno pasado, que nace completado — D4, spec 001 RF-9', () =>
  withAccount(async (account) => {
    const service = await seedService(account.id);
    const pro = await seedUser(account.id);

    const { appointment } = await createAppointmentFromPanel(db, {
      accountId: account.id, actor: { id: 'jwt-owner', role: 'owner' }, serviceId: service.id,
      scheduledAt: new Date(Date.now() - 3 * DAY).toISOString(), clientData: { ...CLIENT }, employeeId: pro.id,
    }, repos);

    assert.equal(appointment.status, 'completado');
  }));

test('GET /availability/:id no devuelve horarios ya transcurridos — RF-9', () =>
  withAccount(async (account) => {
    const service = await seedService(account.id);
    await seedUser(account.id);

    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const to = new Date(startOfToday); to.setDate(to.getDate() + 2);
    const res = await api.get(`/availability/${account.id}?service_id=${service.id}&date_from=${startOfToday.toISOString()}&date_to=${to.toISOString()}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0);
    const now = Date.now();
    for (const slot of res.body) assert.ok(new Date(slot.starts_at).getTime() > now, slot.starts_at);
  }));
