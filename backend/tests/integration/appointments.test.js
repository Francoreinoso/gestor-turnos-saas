import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { appointmentRepo } from '../../src/infrastructure/db/repositories/appointments.js';
import { serviceRepo } from '../../src/infrastructure/db/repositories/services.js';
import { clientRepo } from '../../src/infrastructure/db/repositories/clients.js';
import { tokenRepo } from '../../src/infrastructure/db/repositories/tokens.js';
import { userRepo } from '../../src/infrastructure/db/repositories/users.js';
import { rescheduleAppointment } from '../../src/application/rescheduleAppointment.js';
import { clients, users, services } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

// ─── Helpers de seed ───────────────────────────────────────────────────────────

async function seedUser(db, accountId) {
  return db.insert(users).values({
    account_id: accountId,
    name: 'Prof Test',
    email: `prof-${crypto.randomUUID()}@test.com`,
    password_hash: 'placeholder_no_auth_test',
    role: 'staff',
  }).returning().then(r => r[0]);
}

async function seedClient(db, accountId) {
  return db.insert(clients).values({
    account_id: accountId,
    name: 'Cliente Test',
    email: `cliente-${crypto.randomUUID()}@test.com`,
  }).returning().then(r => r[0]);
}

async function seedService(db, accountId) {
  return db.insert(services).values({
    account_id: accountId,
    name: 'Servicio Test',
    duration_minutes: 60,
    price: '50.00',
  }).returning().then(r => r[0]);
}

// Drizzle envuelve los errores de Postgres en un "Failed query" con el error real en err.cause.
// Este helper normaliza la comparación para assert.rejects a nivel de repo (sin capa application).
const expectDbError = (pattern) => (err) => {
  assert.match(err.cause?.message ?? err.message, pattern);
  return true;
};

// Slots de referencia — no se solapan entre sí salvo donde se indica explícitamente
const t1    = new Date('2026-09-01T10:00:00Z'); // inicio slot A
const t2    = new Date('2026-09-01T11:00:00Z'); // fin slot A  (t1 + 60min)
const t3    = new Date('2026-09-01T10:30:00Z'); // solapado con [t1, t2]
const t4    = new Date('2026-09-01T12:00:00Z'); // sin solapamiento con [t1, t2]
const t4end = new Date('2026-09-01T13:00:00Z'); // fin slot en t4 (t4 + 60min)

// ─── Trigger: prevención de solapamiento ───────────────────────────────────────

test('trigger: rechaza solapamiento entre el mismo profesional', async () => {
  await withAccount(async (account) => {
    const user = await seedUser(db, account.id);
    const client = await seedClient(db, account.id);
    const service = await seedService(db, account.id);

    await appointmentRepo.create(db, {
      account_id: account.id,
      client_id: client.id,
      service_id: service.id,
      assigned_user_id: user.id,
      scheduled_at: t1,
      scheduled_until: t2,
      status: 'agendado',
    });

    await assert.rejects(
      () => appointmentRepo.create(db, {
        account_id: account.id,
        client_id: client.id,
        service_id: service.id,
        assigned_user_id: user.id,
        scheduled_at: t1,
        scheduled_until: t2,
        status: 'agendado',
      }),
      expectDbError(/appointment_overlap/)
    );
  });
});

test('trigger: turno sin solapamiento se inserta correctamente', async () => {
  await withAccount(async (account) => {
    const user = await seedUser(db, account.id);
    const client = await seedClient(db, account.id);
    const service = await seedService(db, account.id);

    await appointmentRepo.create(db, {
      account_id: account.id,
      client_id: client.id,
      service_id: service.id,
      assigned_user_id: user.id,
      scheduled_at: t1,
      scheduled_until: t2,
      status: 'agendado',
    });

    // t2 como inicio → condición strict <, no solapa con [t1, t2]
    await assert.doesNotReject(() =>
      appointmentRepo.create(db, {
        account_id: account.id,
        client_id: client.id,
        service_id: service.id,
        assigned_user_id: user.id,
        scheduled_at: t2,
        scheduled_until: t4,
        status: 'agendado',
      })
    );
  });
});

test('trigger: bloqueo de negocio (assigned_user_id NULL) rechaza cualquier turno en ese rango', async () => {
  await withAccount(async (account) => {
    const user = await seedUser(db, account.id);
    const client = await seedClient(db, account.id);
    const service = await seedService(db, account.id);

    // Bloqueo de negocio completo — sin usuario asignado
    await appointmentRepo.create(db, {
      account_id: account.id,
      assigned_user_id: null,
      scheduled_at: t1,
      scheduled_until: t2,
      status: 'bloqueado',
    });

    await assert.rejects(
      () => appointmentRepo.create(db, {
        account_id: account.id,
        client_id: client.id,
        service_id: service.id,
        assigned_user_id: user.id,
        scheduled_at: t3,
        scheduled_until: t4,
        status: 'agendado',
      }),
      expectDbError(/appointment_overlap/)
    );
  });
});

test('trigger: turno cancelado no bloquea nuevas reservas en el mismo slot', async () => {
  await withAccount(async (account) => {
    const user = await seedUser(db, account.id);
    const client = await seedClient(db, account.id);
    const service = await seedService(db, account.id);

    await appointmentRepo.create(db, {
      account_id: account.id,
      client_id: client.id,
      service_id: service.id,
      assigned_user_id: user.id,
      scheduled_at: t1,
      scheduled_until: t2,
      status: 'cancelado',
    });

    await assert.doesNotReject(() =>
      appointmentRepo.create(db, {
        account_id: account.id,
        client_id: client.id,
        service_id: service.id,
        assigned_user_id: user.id,
        scheduled_at: t1,
        scheduled_until: t2,
        status: 'agendado',
      })
    );
  });
});

// ─── CHECK: nulabilidad condicional ───────────────────────────────────────────

test('CHECK: falla al insertar agendado sin client_id', async () => {
  await withAccount(async (account) => {
    const user = await seedUser(db, account.id);
    const service = await seedService(db, account.id);

    await assert.rejects(
      () => appointmentRepo.create(db, {
        account_id: account.id,
        client_id: null,
        service_id: service.id,
        assigned_user_id: user.id,
        scheduled_at: t1,
        scheduled_until: t2,
        status: 'agendado',
      }),
      expectDbError(/appointments_nullable_fields_check/)
    );
  });
});

test('CHECK: falla al insertar bloqueado con client_id', async () => {
  await withAccount(async (account) => {
    const client = await seedClient(db, account.id);

    await assert.rejects(
      () => appointmentRepo.create(db, {
        account_id: account.id,
        client_id: client.id,
        service_id: null,
        assigned_user_id: null,
        scheduled_at: t1,
        scheduled_until: t2,
        status: 'bloqueado',
      }),
      expectDbError(/appointments_nullable_fields_check/)
    );
  });
});

// ─── CHECK: clientes sin contacto ─────────────────────────────────────────────

test('CHECK: falla al insertar cliente sin email ni phone', async () => {
  await withAccount(async (account) => {
    await assert.rejects(
      () => db.insert(clients).values({
        account_id: account.id,
        name: 'Sin Contacto',
        email: null,
        phone: null,
      }),
      expectDbError(/clients_contact_check/)
    );
  });
});

// ─── Reprogramación: integridad transaccional ─────────────────────────────────

test('reprogramación: revierte si el nuevo turno solapa — fila original queda agendado', async () => {
  await withAccount(async (account) => {
    const user = await seedUser(db, account.id);
    const client = await seedClient(db, account.id);
    const service = await seedService(db, account.id);

    const original = await appointmentRepo.create(db, {
      account_id: account.id,
      client_id: client.id,
      service_id: service.id,
      assigned_user_id: user.id,
      scheduled_at: t1,
      scheduled_until: t2,
      status: 'agendado',
    });

    // Este turno ocupa el slot destino del reschedule — no solapa con [t1, t2]
    await appointmentRepo.create(db, {
      account_id: account.id,
      client_id: client.id,
      service_id: service.id,
      assigned_user_id: user.id,
      scheduled_at: t4,
      scheduled_until: t4end,
      status: 'agendado',
    });

    const repos = {
      appointments: appointmentRepo,
      services: serviceRepo,
      clients: clientRepo,
      tokens: tokenRepo,
      users: userRepo,
    };

    // Reprogramar al slot ocupado (t4) → trigger lanza → transacción revierte
    // createAppointment convierte el error en { message: 'appointment_overlap', status: 409 }
    await assert.rejects(
      () => rescheduleAppointment(db, original, {
        serviceId: service.id,
        scheduledAt: t4,
        employeeId: user.id,
      }, repos),
      { message: 'appointment_overlap', status: 409 }
    );

    const refetched = await appointmentRepo.findById(db, original.id);
    assert.equal(refetched.status, 'agendado');
  });
});
