import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { paymentRepo } from '../../src/infrastructure/db/repositories/payments.js';
import { users, services, appointments, payments, clients } from '../../db/schema.js';

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
    account_id: accountId,
    name: 'Servicio Test',
    duration_minutes: 60,
    price: '100.00',
  }).returning().then(r => r[0]);
}

async function seedClient(accountId) {
  return db.insert(clients).values({
    account_id: accountId,
    name: 'Cliente Test',
    email: `cliente-${crypto.randomUUID()}@test.com`,
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

async function seedPayment(accountId, { appointmentId, assignedUserId, amount, commissionRateApplied = null, employeeAmount, businessAmount }) {
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

const PERIOD = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59.999Z') };

// spec 003 T04 — RF-1, RF-4, RF-5, RF-6, RF-16
test('summarize: agrega el período, ignora NULL de contrato fijo en profesional/negocio pero cuenta en facturado', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.4000' });
    const u2 = await seedUser(account.id); // contrato fijo — sin comisión propia ni de cuenta

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '100.00', commissionRateApplied: '0.4000', employeeAmount: '40.00', businessAmount: '60.00' });

    const a2 = await seedCompletedAppointment(account.id, { assignedUserId: u2.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-15T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a2.id, assignedUserId: u2.id, amount: '50.00', employeeAmount: null, businessAmount: null });

    const summary = await paymentRepo.summarize(db, { accountId: account.id, ...PERIOD });
    assert.equal(summary.totalAmount, 150);
    assert.equal(summary.employeeAmount, 40); // solo el pago con comisión resuelta
    assert.equal(summary.businessAmount, 60);
    assert.equal(summary.paymentCount, 2);
  }));

test('summarize: filtro por employeeId restringe a un solo profesional', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.5000' });
    const u2 = await seedUser(account.id, { commission_rate: '0.2000' });

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '100.00', commissionRateApplied: '0.5000', employeeAmount: '50.00', businessAmount: '50.00' });

    const a2 = await seedCompletedAppointment(account.id, { assignedUserId: u2.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-11T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a2.id, assignedUserId: u2.id, amount: '200.00', commissionRateApplied: '0.2000', employeeAmount: '40.00', businessAmount: '160.00' });

    const summary = await paymentRepo.summarize(db, { accountId: account.id, employeeId: u1.id, ...PERIOD });
    assert.equal(summary.totalAmount, 100);
    assert.equal(summary.paymentCount, 1);
  }));

test('summarize: período sin pagos → todo en 0, nunca NULL', () =>
  withAccount(async (account) => {
    const summary = await paymentRepo.summarize(db, { accountId: account.id, ...PERIOD });
    assert.equal(summary.totalAmount, 0);
    assert.equal(summary.employeeAmount, 0);
    assert.equal(summary.businessAmount, 0);
    assert.equal(summary.paymentCount, 0);
  }));

// spec 003 T05 — RF-2, RF-3
test('summarizeByEmployee: una fila por profesional con montos correctos; contrato fijo en 0 sin excluirse', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.4000' });
    const u2 = await seedUser(account.id); // contrato fijo

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '100.00', commissionRateApplied: '0.4000', employeeAmount: '40.00', businessAmount: '60.00' });

    const a2 = await seedCompletedAppointment(account.id, { assignedUserId: u2.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-15T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a2.id, assignedUserId: u2.id, amount: '50.00', employeeAmount: null, businessAmount: null });

    const rows = await paymentRepo.summarizeByEmployee(db, { accountId: account.id, ...PERIOD });
    assert.equal(rows.length, 2);

    const row1 = rows.find(r => r.employeeId === u1.id);
    assert.equal(row1.totalAmount, 100);
    assert.equal(row1.employeeAmount, 40);
    assert.equal(row1.businessAmount, 60);

    const row2 = rows.find(r => r.employeeId === u2.id);
    assert.equal(row2.totalAmount, 50); // cuenta en lo generado
    assert.equal(row2.employeeAmount, 0); // no se reparte (D8)
    assert.equal(row2.businessAmount, 0);
  }));

test('summarizeByEmployee: filtro por employeeId reduce el desglose a una sola fila', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.5000' });
    const u2 = await seedUser(account.id, { commission_rate: '0.2000' });

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-10T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '100.00', commissionRateApplied: '0.5000', employeeAmount: '50.00', businessAmount: '50.00' });

    const a2 = await seedCompletedAppointment(account.id, { assignedUserId: u2.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-11T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a2.id, assignedUserId: u2.id, amount: '200.00', commissionRateApplied: '0.2000', employeeAmount: '40.00', businessAmount: '160.00' });

    const rows = await paymentRepo.summarizeByEmployee(db, { accountId: account.id, employeeId: u1.id, ...PERIOD });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].employeeId, u1.id);
  }));

// spec 003 T06 — RF-8, RF-9, RF-16
test('findForList: ordena y filtra por scheduled_at del turno, no por created_at del pago', () =>
  withAccount(async (account) => {
    const svc = await seedService(account.id);
    const cli = await seedClient(account.id);
    const u1 = await seedUser(account.id, { commission_rate: '0.3000' });

    const a1 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-05T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a1.id, assignedUserId: u1.id, amount: '10.00', commissionRateApplied: '0.3000', employeeAmount: '3.00', businessAmount: '7.00' });

    const a2 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-20T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a2.id, assignedUserId: u1.id, amount: '20.00', commissionRateApplied: '0.3000', employeeAmount: '6.00', businessAmount: '14.00' });

    const a3 = await seedCompletedAppointment(account.id, { assignedUserId: u1.id, serviceId: svc.id, clientId: cli.id, scheduledAt: new Date('2026-09-12T10:00:00Z') });
    await seedPayment(account.id, { appointmentId: a3.id, assignedUserId: u1.id, amount: '15.00', commissionRateApplied: '0.3000', employeeAmount: '4.50', businessAmount: '10.50' });

    const rows = await paymentRepo.findForList(db, { accountId: account.id, limit: 2, ...PERIOD });
    assert.equal(rows.length, 2);
    // más reciente primero: Sep 20, luego Sep 12 — nunca por created_at (los 3 se insertaron en orden Sep5, Sep20, Sep12)
    assert.deepEqual(rows.map(r => r.scheduledAt), [new Date('2026-09-20T10:00:00Z'), new Date('2026-09-12T10:00:00Z')]);
    // spec 010 RF-23: cada fila trae el cliente y el servicio del turno
    assert.equal(rows[0].clientName, 'Cliente Test');
    assert.equal(rows[0].serviceName, 'Servicio Test');
  }));
