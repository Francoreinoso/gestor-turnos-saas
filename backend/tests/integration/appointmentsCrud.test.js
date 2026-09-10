import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { appointmentRepo } from '../../src/infrastructure/db/repositories/appointments.js';
import { serviceRepo } from '../../src/infrastructure/db/repositories/services.js';
import { clientRepo } from '../../src/infrastructure/db/repositories/clients.js';
import { tokenRepo } from '../../src/infrastructure/db/repositories/tokens.js';
import { userRepo } from '../../src/infrastructure/db/repositories/users.js';
import { paymentRepo } from '../../src/infrastructure/db/repositories/payments.js';
import { accountRepo } from '../../src/infrastructure/db/repositories/accounts.js';
import { createAppointmentFromPanel } from '../../src/application/createAppointmentFromPanel.js';
import { editAppointment } from '../../src/application/editAppointment.js';
import { cancelAppointment } from '../../src/application/cancelAppointment.js';
import { cancelBlock } from '../../src/application/cancelBlock.js';
import { eq, and } from 'drizzle-orm';
import { clients, users, services, availability, appointments, payments } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

const repos = {
  appointments: appointmentRepo, services: serviceRepo, clients: clientRepo,
  tokens: tokenRepo, users: userRepo, payments: paymentRepo, accounts: accountRepo,
};

const HOUR = 60 * 60 * 1000;
const owner = { id: 'owner-jwt', role: 'owner' };

async function seedUser(db, accountId, { withAvailability = true } = {}) {
  const user = await db.insert(users).values({
    account_id: accountId, name: 'Prof', role: 'staff',
    email: `p-${crypto.randomUUID()}@t.com`, password_hash: 'x',
  }).returning().then(r => r[0]);
  if (withAvailability) {
    await db.insert(availability).values(
      Array.from({ length: 7 }, (_, dow) => ({
        user_id: user.id, day_of_week: dow, start_time: '00:00:00', end_time: '23:59:59',
      })),
    );
  }
  return user;
}

const seedClient = (db, accountId) =>
  db.insert(clients).values({ account_id: accountId, name: 'Cli', email: `c-${crypto.randomUUID()}@t.com` })
    .returning().then(r => r[0]);

const seedService = (db, accountId, duration = 60) =>
  db.insert(services).values({ account_id: accountId, name: 'Svc', duration_minutes: duration, price: '50.00' })
    .returning().then(r => r[0]);

// ─── T20 · crear desde el panel ───────────────────────────────────────────────

test('RF-9: fin pasado → turno completado + fila de pago', async () => {
  await withAccount(async (acc) => {
    const [user, client, service] = await Promise.all([seedUser(db, acc.id), seedClient(db, acc.id), seedService(db, acc.id)]);
    const { appointment } = await createAppointmentFromPanel(db, {
      accountId: acc.id, actor: owner, serviceId: service.id, clientId: client.id,
      employeeId: user.id, scheduledAt: new Date(Date.now() - 3 * HOUR).toISOString(),
    }, repos);

    assert.equal(appointment.status, 'completado');
    const pays = await db.select().from(payments).where(eq(payments.appointment_id, appointment.id));
    assert.equal(pays.length, 1);
  });
});

test('RF-9: si falla el pago, no queda el turno (rollback)', async () => {
  await withAccount(async (acc) => {
    const [user, client, service] = await Promise.all([seedUser(db, acc.id), seedClient(db, acc.id), seedService(db, acc.id)]);
    const brokenRepos = { ...repos, payments: { ...paymentRepo, create: async () => { throw new Error('boom'); } } };

    await assert.rejects(() => createAppointmentFromPanel(db, {
      accountId: acc.id, actor: owner, serviceId: service.id, clientId: client.id,
      employeeId: user.id, scheduledAt: new Date(Date.now() - 3 * HOUR).toISOString(),
    }, brokenRepos), { message: 'boom' });

    const rows = await db.select().from(appointments).where(eq(appointments.account_id, acc.id));
    assert.equal(rows.length, 0);
  });
});

test('RF-16: staff que pasa otro profesional queda asignado a sí mismo', async () => {
  await withAccount(async (acc) => {
    const [staff, other, client, service] = await Promise.all([
      seedUser(db, acc.id), seedUser(db, acc.id), seedClient(db, acc.id), seedService(db, acc.id),
    ]);
    const { appointment } = await createAppointmentFromPanel(db, {
      accountId: acc.id, actor: { id: staff.id, role: 'staff' }, serviceId: service.id, clientId: client.id,
      employeeId: other.id, scheduledAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    }, repos);
    assert.equal(appointment.assigned_user_id, staff.id);
  });
});

test('RF-7: autoasignación sin disponibilidad → 409', async () => {
  await withAccount(async (acc) => {
    await seedUser(db, acc.id, { withAvailability: false });
    const [client, service] = await Promise.all([seedClient(db, acc.id), seedService(db, acc.id)]);
    await assert.rejects(() => createAppointmentFromPanel(db, {
      accountId: acc.id, actor: owner, serviceId: service.id, clientId: client.id,
      scheduledAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    }, repos), { message: 'no_professional_available', status: 409 });
  });
});

test('RF-6: autoasignación con disponibilidad asigna al profesional libre', async () => {
  await withAccount(async (acc) => {
    const user = await seedUser(db, acc.id); // withAvailability: true (7 días 00-24)
    const [client, service] = await Promise.all([seedClient(db, acc.id), seedService(db, acc.id)]);
    const { appointment } = await createAppointmentFromPanel(db, {
      accountId: acc.id, actor: owner, serviceId: service.id, clientId: client.id,
      scheduledAt: new Date(Date.now() + 500 * HOUR).toISOString(),
    }, repos);
    assert.equal(appointment.assigned_user_id, user.id);
  });
});

test('RF-10: bloqueo de negocio impide crear en esa franja → 409', async () => {
  await withAccount(async (acc) => {
    const [user, client, service] = await Promise.all([seedUser(db, acc.id), seedClient(db, acc.id), seedService(db, acc.id)]);
    const start = new Date(Date.now() + 48 * HOUR);
    await appointmentRepo.create(db, {
      account_id: acc.id, assigned_user_id: null, status: 'bloqueado',
      scheduled_at: start, scheduled_until: new Date(start.getTime() + 2 * HOUR),
    });
    await assert.rejects(() => createAppointmentFromPanel(db, {
      accountId: acc.id, actor: owner, serviceId: service.id, clientId: client.id,
      employeeId: user.id, scheduledAt: start.toISOString(),
    }, repos), { message: 'appointment_overlap', status: 409 });
  });
});

// ─── T21 · editar ────────────────────────────────────────────────────────────

async function seedAgendado(db, acc, { userId, start, duration = 60 }) {
  const client = await seedClient(db, acc.id);
  const service = await seedService(db, acc.id, duration);
  const appt = await appointmentRepo.create(db, {
    account_id: acc.id, client_id: client.id, service_id: service.id, assigned_user_id: userId,
    scheduled_at: start, scheduled_until: new Date(start.getTime() + duration * 60000), status: 'agendado',
  });
  return { client, service, appt };
}

test('RF-25/RF-29: cambiar a un servicio más largo que pisa el turno siguiente → 409, fila intacta', async () => {
  await withAccount(async (acc) => {
    const user = await seedUser(db, acc.id);
    const t10 = new Date(Date.now() + 72 * HOUR);
    const { appt } = await seedAgendado(db, acc, { userId: user.id, start: t10, duration: 60 });
    // Turno siguiente pegado: [11:00, 12:00]
    await seedAgendado(db, acc, { userId: user.id, start: new Date(t10.getTime() + HOUR), duration: 60 });
    const longSvc = await seedService(db, acc.id, 120); // 10:00 + 120 = 12:00 → pisa

    await assert.rejects(() => editAppointment(db, {
      id: appt.id, accountId: acc.id, actor: owner, body: { service_id: longSvc.id },
    }, repos), { message: 'appointment_overlap', status: 409 });

    const after = await appointmentRepo.findById(db, appt.id);
    assert.equal(after.service_id, appt.service_id);
    assert.deepEqual(after.scheduled_until, appt.scheduled_until);
  });
});

test('RF-20: editar notes a null la limpia', async () => {
  await withAccount(async (acc) => {
    const user = await seedUser(db, acc.id);
    const { appt } = await seedAgendado(db, acc, { userId: user.id, start: new Date(Date.now() + 96 * HOUR) });
    await appointmentRepo.update(db, appt.id, { notes: 'algo' });
    const updated = await editAppointment(db, { id: appt.id, accountId: acc.id, actor: owner, body: { notes: null } }, repos);
    assert.equal(updated.notes, null);
  });
});

test('RF-22: status en el body → 400', async () => {
  await withAccount(async (acc) => {
    const user = await seedUser(db, acc.id);
    const { appt } = await seedAgendado(db, acc, { userId: user.id, start: new Date(Date.now() + 100 * HOUR) });
    await assert.rejects(() => editAppointment(db, {
      id: appt.id, accountId: acc.id, actor: owner, body: { status: 'cancelado' },
    }, repos), { message: 'invalid_field', status: 400 });
  });
});

test('glosario: turnos adyacentes (fin == inicio) no solapan', async () => {
  await withAccount(async (acc) => {
    const [user, client] = await Promise.all([seedUser(db, acc.id), seedClient(db, acc.id)]);
    const service = await seedService(db, acc.id, 60);
    const start = new Date(Date.now() + 120 * HOUR);
    const mk = (s) => createAppointmentFromPanel(db, {
      accountId: acc.id, actor: owner, serviceId: service.id, clientId: client.id, employeeId: user.id,
      scheduledAt: s.toISOString(),
    }, repos);
    await assert.doesNotReject(() => mk(start));
    await assert.doesNotReject(() => mk(new Date(start.getTime() + HOUR)));
  });
});

// ─── T22 · alcance por rol ───────────────────────────────────────────────────

test('RF-34/RF-35: turno de otra cuenta → 404, nunca 403', async () => {
  await withAccount(async (accA) => {
    await withAccount(async (accB) => {
      const user = await seedUser(db, accA.id);
      const { appt } = await seedAgendado(db, accA, { userId: user.id, start: new Date(Date.now() + 130 * HOUR) });

      const forB = { id: appt.id, accountId: accB.id, actor: owner, body: { notes: 'x' } };
      await assert.rejects(() => editAppointment(db, forB, repos), { status: 404 });
      await assert.rejects(() => cancelBlock(db, forB, repos), { status: 404 });
    });
  });
});

test('RF-34: staff sobre turno de otro profesional → 404', async () => {
  await withAccount(async (acc) => {
    const [owner1, other] = await Promise.all([seedUser(db, acc.id), seedUser(db, acc.id)]);
    const { appt } = await seedAgendado(db, acc, { userId: owner1.id, start: new Date(Date.now() + 140 * HOUR) });
    await assert.rejects(() => editAppointment(db, {
      id: appt.id, accountId: acc.id, actor: { id: other.id, role: 'staff' }, body: { notes: 'x' },
    }, repos), { message: 'not_found', status: 404 });
  });
});

// ─── T23 · cancelar bloqueo ──────────────────────────────────────────────────

test('RF-46/RF-47: cancel-block deja la fila con status cancelado; repetir → 422', async () => {
  await withAccount(async (acc) => {
    const user = await seedUser(db, acc.id);
    const start = new Date(Date.now() + 150 * HOUR);
    const block = await appointmentRepo.create(db, {
      account_id: acc.id, assigned_user_id: user.id, status: 'bloqueado',
      scheduled_at: start, scheduled_until: new Date(start.getTime() + HOUR),
    });

    await cancelBlock(db, { id: block.id, accountId: acc.id, actor: owner }, repos);
    const row = await appointmentRepo.findById(db, block.id);
    assert.equal(row.status, 'cancelado'); // no se borró

    await assert.rejects(
      () => cancelBlock(db, { id: block.id, accountId: acc.id, actor: owner }, repos),
      { message: 'invalid_status_transition', status: 422 },
    );

    // liberado el bloqueo, el slot queda disponible
    const [client, service] = await Promise.all([seedClient(db, acc.id), seedService(db, acc.id)]);
    await assert.doesNotReject(() => createAppointmentFromPanel(db, {
      accountId: acc.id, actor: owner, serviceId: service.id, clientId: client.id, employeeId: user.id,
      scheduledAt: start.toISOString(),
    }, repos));
  });
});

test('RF-32/RF-48: staff sobre bloqueo de negocio → 404', async () => {
  await withAccount(async (acc) => {
    const staff = await seedUser(db, acc.id);
    const start = new Date(Date.now() + 160 * HOUR);
    const block = await appointmentRepo.create(db, {
      account_id: acc.id, assigned_user_id: null, status: 'bloqueado',
      scheduled_at: start, scheduled_until: new Date(start.getTime() + HOUR),
    });
    await assert.rejects(
      () => cancelBlock(db, { id: block.id, accountId: acc.id, actor: { id: staff.id, role: 'staff' } }, repos),
      { message: 'not_found', status: 404 },
    );
  });
});

// ─── T24 · listado ───────────────────────────────────────────────────────────

test('RF-41: findForList respeta el limit', async () => {
  await withAccount(async (acc) => {
    const user = await seedUser(db, acc.id);
    const base = Date.now() + 200 * HOUR;
    for (let i = 0; i < 5; i++) {
      await seedAgendado(db, acc, { userId: user.id, start: new Date(base + i * HOUR) });
    }
    const rows = await appointmentRepo.findForList(db, { accountId: acc.id, filters: {}, limit: 3 });
    assert.equal(rows.length, 3);
  });
});

test('RF-42: staff solo ve sus turnos', async () => {
  await withAccount(async (acc) => {
    const [u1, u2] = await Promise.all([seedUser(db, acc.id), seedUser(db, acc.id)]);
    const base = Date.now() + 300 * HOUR;
    await seedAgendado(db, acc, { userId: u1.id, start: new Date(base) });
    await seedAgendado(db, acc, { userId: u2.id, start: new Date(base + HOUR) });
    const rows = await appointmentRepo.findForList(db, { accountId: acc.id, filters: { employeeId: u1.id }, limit: 500 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].assigned_user_id, u1.id);
  });
});

test('RF-36/RF-37/RF-38: filtra por rango sobre scheduled_at, ordena asc y trae el shape resumido', async () => {
  await withAccount(async (acc) => {
    const user = await seedUser(db, acc.id);
    const base = Date.now() + 700 * HOUR;
    // tres turnos en horas 0, 24 y 48 desde `base`
    await seedAgendado(db, acc, { userId: user.id, start: new Date(base + 48 * HOUR) });
    await seedAgendado(db, acc, { userId: user.id, start: new Date(base) });
    await seedAgendado(db, acc, { userId: user.id, start: new Date(base + 24 * HOUR) });

    // ventana que deja fuera el de +48h
    const rows = await appointmentRepo.findForList(db, {
      accountId: acc.id,
      filters: {
        status: 'agendado',
        dateFrom: new Date(base - HOUR),
        dateTo: new Date(base + 25 * HOUR),
      },
      limit: 500,
    });

    assert.equal(rows.length, 2); // RF-38: filtró por scheduled_at
    assert.ok(rows[0].scheduled_at < rows[1].scheduled_at); // RF-36: orden asc

    // RF-36: proyección resumida
    assert.deepEqual(Object.keys(rows[0].client).sort(), ['email', 'id', 'name', 'phone']);
    assert.deepEqual(Object.keys(rows[0].service).sort(), ['duration_minutes', 'id', 'name', 'price']);
    assert.deepEqual(Object.keys(rows[0].assignedUser).sort(), ['id', 'name']);
  });
});

test('RF-37: los filtros combinan en AND', async () => {
  await withAccount(async (acc) => {
    const [u1, u2] = await Promise.all([seedUser(db, acc.id), seedUser(db, acc.id)]);
    const base = Date.now() + 900 * HOUR;
    const { appt } = await seedAgendado(db, acc, { userId: u1.id, start: new Date(base) });
    await seedAgendado(db, acc, { userId: u2.id, start: new Date(base + HOUR) });
    await appointmentRepo.update(db, appt.id, { status: 'cancelado' });

    // agendado + u1 → no matchea (el de u1 quedó cancelado)
    const rows = await appointmentRepo.findForList(db, {
      accountId: acc.id, filters: { status: 'agendado', employeeId: u1.id }, limit: 500,
    });
    assert.equal(rows.length, 0);
  });
});

// ─── T25 · constraint de duración ────────────────────────────────────────────

test('RF-12: la DB rechaza un servicio con duración 0', async () => {
  await withAccount(async (acc) => {
    await assert.rejects(
      () => db.insert(services).values({ account_id: acc.id, name: 'Cero', duration_minutes: 0, price: '10.00' }),
      (err) => /services_duration_positive/.test(err.cause?.message ?? err.message),
    );
  });
});
