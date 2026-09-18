import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import * as repos from '../../src/infrastructure/db/repositories/index.js';
import { getPaymentsSummary } from '../../src/application/getPaymentsSummary.js';
import { listPayments } from '../../src/application/listPayments.js';
import { users, services, clients, appointments, payments } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

// ─── Helpers de seed ───────────────────────────────────────────────────────────

async function seedUser(accountId, { commission_rate = null } = {}) {
  return db.insert(users).values({
    account_id: accountId,
    name: `Prof ${crypto.randomUUID().slice(0, 8)}`,
    email: `prof-${crypto.randomUUID()}@test.com`,
    password_hash: 'placeholder_no_auth_test',
    role: 'staff',
    commission_rate,
  }).returning().then(r => r[0]);
}

async function seedService(accountId) {
  return db.insert(services).values({
    account_id: accountId, name: 'Servicio Test', duration_minutes: 60, price: '100.00',
  }).returning().then(r => r[0]);
}

async function seedClient(accountId) {
  return db.insert(clients).values({
    account_id: accountId, name: 'Cliente Test', email: `cliente-${crypto.randomUUID()}@test.com`,
  }).returning().then(r => r[0]);
}

async function seedCompletedAppointment(accountId, { assignedUserId, serviceId, clientId, scheduledAt }) {
  return db.insert(appointments).values({
    account_id: accountId,
    assigned_user_id: assignedUserId,
    service_id: serviceId,
    client_id: clientId,
    scheduled_at: scheduledAt,
    scheduled_until: new Date(scheduledAt.getTime() + 60 * 60 * 1000),
    status: 'completado',
  }).returning().then(r => r[0]);
}

async function seedPayment(accountId, { appointmentId, assignedUserId, amount, commissionRateApplied = null, employeeAmount = null, businessAmount = null }) {
  return db.insert(payments).values({
    account_id: accountId,
    appointment_id: appointmentId,
    assigned_user_id: assignedUserId,
    amount,
    commission_rate_applied: commissionRateApplied,
    employee_amount: employeeAmount,
    business_amount: businessAmount,
  }).returning().then(r => r[0]);
}

const now = new Date('2026-09-17T12:00:00Z');
const PERIOD_QUERY = { date_from: '2026-09-01T00:00:00Z', date_to: '2026-09-30T23:59:59.999Z' };
const owner = { role: 'owner' };

// T13 — RF-1, RF-2
test('resumen del owner: totales correctos y desglose por 2 profesionales', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.5000' });
    const u2 = await seedUser(account.id, { commission_rate: '0.2000' });

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '100.00', commissionRateApplied: '0.5000', employeeAmount: '50.00', businessAmount: '50.00' });

    const a2 = await seedCompletedAppointment(account.id, { assignedUserId: u2.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-11T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a2.id, assignedUserId: u2.id, amount: '200.00', commissionRateApplied: '0.2000', employeeAmount: '40.00', businessAmount: '160.00' });

    const result = await getPaymentsSummary(db, { accountId: account.id, actor: owner, query: PERIOD_QUERY, now }, repos);
    assert.equal(result.totalAmount, 300);
    assert.equal(result.employeeAmount, 90);
    assert.equal(result.businessAmount, 210);
    assert.equal(result.paymentCount, 2);
    assert.equal(result.byEmployee.length, 2);
    assert.deepEqual(result.byEmployee.find(r => r.employeeId === u1.id), { employeeId: u1.id, employeeName: u1.name, totalAmount: 100, employeeAmount: 50, businessAmount: 50 });
  }));

// T14 — RF-5
test('pago de "contrato fijo": cuenta en facturado y en generado del profesional, no en profesional/negocio', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id); // sin comisión propia

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '80.00' }); // sin rate/employee/business

    const result = await getPaymentsSummary(db, { accountId: account.id, actor: owner, query: PERIOD_QUERY, now }, repos);
    assert.equal(result.totalAmount, 80);
    assert.equal(result.employeeAmount, 0);
    assert.equal(result.businessAmount, 0);
    assert.equal(result.byEmployee[0].totalAmount, 80);
    assert.equal(result.byEmployee[0].employeeAmount, 0);
    assert.equal(result.byEmployee[0].businessAmount, 0);
  }));

// T15 — RF-6, RF-7, RF-8, RF-9
test('alcance del staff: solo su propio resumen/listado, con monto al negocio visible en su propio pago', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.4000' });
    const u2 = await seedUser(account.id, { commission_rate: '0.3000' });

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '100.00', commissionRateApplied: '0.4000', employeeAmount: '40.00', businessAmount: '60.00' });

    const a2 = await seedCompletedAppointment(account.id, { assignedUserId: u2.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-11T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a2.id, assignedUserId: u2.id, amount: '50.00', commissionRateApplied: '0.3000', employeeAmount: '15.00', businessAmount: '35.00' });

    const staffActor = { id: u1.id, role: 'staff' };

    // resumen: nunca trae byEmployee ni el consolidado; filtro forzado a sí mismo aunque pida el de u2
    const summary = await getPaymentsSummary(db, { accountId: account.id, actor: staffActor, query: { ...PERIOD_QUERY, employee_id: u2.id }, now }, repos);
    assert.equal(summary.totalAmount, 100); // solo lo de u1, no lo de u2
    assert.equal(summary.employeeAmount, 40); // RF-6: lo que le corresponde a él
    assert.equal(summary.businessAmount, 60); // RF-6: lo que dejó al negocio
    assert.equal(summary.paymentCount, 1); // RF-6: cantidad de pagos
    assert.equal('byEmployee' in summary, false);

    // listado: solo sus propios pagos, con el monto al negocio visible
    const listing = await listPayments(db, { accountId: account.id, actor: staffActor, query: { ...PERIOD_QUERY, employee_id: u2.id }, now }, repos);
    assert.equal(listing.payments.length, 1);
    assert.equal(listing.payments[0].employeeId, u1.id);
    assert.equal(listing.payments[0].businessAmount, '60.00');
  }));

// T16 — RF-4
test('filtro por profesional de otra cuenta y por uno inexistente: mismo resultado vacío', () =>
  withAccount(async (account) => withAccount(async (otherAccount) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.5000' });
    const otherSvc = await seedService(otherAccount.id);
    const otherCli = await seedClient(otherAccount.id);
    const foreignUser = await seedUser(otherAccount.id, { commission_rate: '0.5000' });

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '100.00', commissionRateApplied: '0.5000', employeeAmount: '50.00', businessAmount: '50.00' });

    // profesional de otra cuenta
    const foreign = await getPaymentsSummary(db, { accountId: account.id, actor: owner, query: { ...PERIOD_QUERY, employee_id: foreignUser.id }, now }, repos);
    assert.equal(foreign.totalAmount, 0);
    assert.equal(foreign.paymentCount, 0);
    assert.deepEqual(foreign.byEmployee, []);

    // profesional inexistente
    const missing = await getPaymentsSummary(db, { accountId: account.id, actor: owner, query: { ...PERIOD_QUERY, employee_id: crypto.randomUUID() }, now }, repos);
    assert.deepEqual(missing, foreign); // mismo shape, mismo resultado vacío

    void otherSvc; void otherCli; // solo para poblar la otra cuenta, sin usarse directamente
  })));

// T17 — RF-1 (caso límite)
test('período sin pagos: resumen en 0 (nunca NULL), listado vacío', () =>
  withAccount(async (account) => {
    const result = await getPaymentsSummary(db, { accountId: account.id, actor: owner, query: PERIOD_QUERY, now }, repos);
    assert.equal(result.totalAmount, 0);
    assert.equal(result.employeeAmount, 0);
    assert.equal(result.businessAmount, 0);
    assert.equal(result.paymentCount, 0);
    assert.deepEqual(result.byEmployee, []);

    const listing = await listPayments(db, { accountId: account.id, actor: owner, query: PERIOD_QUERY, now }, repos);
    assert.deepEqual(listing, { payments: [], hasMore: false });
  }));

// T18 — RF-10 (verificado a nivel de repo con un límite chico, mismo criterio
// que RF-41 de spec 001 — no hace falta insertar 500+ filas reales para
// probar la propiedad: el resumen no se recorta, el listado sí).
test('listado por encima del límite: se corta e indica que hay más; el resumen sigue sumando todo', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.5000' });

    for (let i = 0; i < 3; i++) {
      const a = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date(`2026-09-1${i}T10:00:00Z`) });
      await seedPayment(account.id, { appointmentId: a.id, assignedUserId: u1.id, amount: '10.00', commissionRateApplied: '0.5000', employeeAmount: '5.00', businessAmount: '5.00' });
    }

    // límite del repo directo — misma query que usa listPayments, con un tope chico
    const rows = await repos.payments.findForList(db, { accountId: account.id, from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59.999Z'), limit: 2 });
    assert.equal(rows.length, 2); // se corta

    const summary = await repos.payments.summarize(db, { accountId: account.id, from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59.999Z') });
    assert.equal(summary.totalAmount, 30); // suma las 3, no las 2 del listado recortado
    assert.equal(summary.paymentCount, 3);
  }));

// Cierre de huecos detectados en la auditoría RF-por-RF

// RF-3: el owner filtra listPayments (no solo el resumen) por un profesional válido.
test('RF-3: owner filtra listPayments por employee_id válido → solo los pagos de ese profesional', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.5000' });
    const u2 = await seedUser(account.id, { commission_rate: '0.2000' });

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '100.00', commissionRateApplied: '0.5000', employeeAmount: '50.00', businessAmount: '50.00' });

    const a2 = await seedCompletedAppointment(account.id, { assignedUserId: u2.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-11T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a2.id, assignedUserId: u2.id, amount: '200.00', commissionRateApplied: '0.2000', employeeAmount: '40.00', businessAmount: '160.00' });

    const listing = await listPayments(db, { accountId: account.id, actor: owner, query: { ...PERIOD_QUERY, employee_id: u1.id }, now }, repos);
    assert.equal(listing.payments.length, 1);
    assert.equal(listing.payments[0].employeeId, u1.id);
  }));

// RF-4: el owner filtra listPayments (no solo el resumen) por un profesional ajeno/inexistente.
test('RF-4: owner filtra listPayments por employee_id de otra cuenta o inexistente → listado vacío en ambos casos', () =>
  withAccount(async (account) => withAccount(async (otherAccount) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.5000' });
    const foreignUser = await seedUser(otherAccount.id, { commission_rate: '0.5000' });

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '100.00', commissionRateApplied: '0.5000', employeeAmount: '50.00', businessAmount: '50.00' });

    const foreign = await listPayments(db, { accountId: account.id, actor: owner, query: { ...PERIOD_QUERY, employee_id: foreignUser.id }, now }, repos);
    assert.deepEqual(foreign, { payments: [], hasMore: false });

    const missing = await listPayments(db, { accountId: account.id, actor: owner, query: { ...PERIOD_QUERY, employee_id: crypto.randomUUID() }, now }, repos);
    assert.deepEqual(missing, { payments: [], hasMore: false });
  })));

// RF-17: rango invertido contra Postgres real (no solo que el dominio no lance excepción).
test('RF-17: date_from > date_to contra la DB real → resumen en 0 y listado vacío, sin error', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.5000' });

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '100.00', commissionRateApplied: '0.5000', employeeAmount: '50.00', businessAmount: '50.00' });

    const invertedQuery = { date_from: '2026-09-20T00:00:00Z', date_to: '2026-09-01T00:00:00Z' };

    const summary = await getPaymentsSummary(db, { accountId: account.id, actor: owner, query: invertedQuery, now }, repos);
    assert.equal(summary.totalAmount, 0);
    assert.equal(summary.paymentCount, 0);
    assert.deepEqual(summary.byEmployee, []);

    const listing = await listPayments(db, { accountId: account.id, actor: owner, query: invertedQuery, now }, repos);
    assert.deepEqual(listing, { payments: [], hasMore: false });
  }));

// T20 — impacto fuera de la spec: no hay migración 0006 para esta spec.
test('no se agregó ninguna migración nueva para esta spec', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  assert.ok(!files.some(f => f.startsWith('0006')), 'no debe existir una migración 0006');
});
