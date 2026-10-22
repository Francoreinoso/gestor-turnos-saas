// spec 008 RF-20 — dentro de una transacción no se lanzan consultas en paralelo sobre el mismo cliente de pg.
// Archivo propio: Node emite cada advertencia una sola vez por proceso, y otro test podría "gastarla" antes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import * as repos from '../../src/infrastructure/db/repositories/index.js';
import { createAppointmentFromPanel } from '../../src/application/createAppointmentFromPanel.js';
import { seedDemo } from '../../db/seed.js';
import { users, services, accounts, payments } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

const warnings = [];
process.on('warning', (w) => warnings.push(w));
const concurrent = () => warnings.filter((w) => /already executing a query/i.test(w.message));
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('crear un turno pasado (con su pago, en transacción) no emite la advertencia de pg — RF-20', () =>
  withAccount(async (account) => {
    const [owner] = await db.insert(users).values({ account_id: account.id, name: 'O', email: `o-${crypto.randomUUID()}@t.com`, role: 'owner', password_hash: 'x' }).returning();
    const [staff] = await db.insert(users).values({ account_id: account.id, name: 'S', email: `s-${crypto.randomUUID()}@t.com`, role: 'staff', password_hash: 'x', commission_rate: '0.5' }).returning();
    const [svc] = await db.insert(services).values({ account_id: account.id, name: 'Corte', duration_minutes: 30, price: '100.00' }).returning();

    const past = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const { appointment } = await createAppointmentFromPanel(db, {
      accountId: account.id, actor: { id: owner.id, role: 'owner' }, serviceId: svc.id,
      scheduledAt: past.toISOString(), clientData: { name: 'Cliente', email: `c-${crypto.randomUUID()}@t.com` }, employeeId: staff.id,
    }, repos);
    await flush();

    assert.equal(appointment.status, 'completado');
    const [payment] = await db.select().from(payments).where(eq(payments.appointment_id, appointment.id));
    assert.equal(Number(payment.amount), 100);
    assert.deepEqual(concurrent().map((w) => w.message), []);
  }));

test('correr el seed de la demo no emite la advertencia de pg — RF-20', async () => {
  const accountId = crypto.randomUUID();
  try {
    await seedDemo(db, { accountId, emailPrefix: `w${accountId.slice(0, 8)}`, env: {} });
    await flush();
    assert.deepEqual(concurrent().map((w) => w.message), []);
  } finally {
    await db.delete(accounts).where(eq(accounts.id, accountId));
  }
});
