import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { userRepo } from '../../src/infrastructure/db/repositories/users.js';
import { staffInvitationTokenRepo } from '../../src/infrastructure/db/repositories/staffInvitationTokens.js';
import { appointmentRepo } from '../../src/infrastructure/db/repositories/appointments.js';
import { inviteStaff as inviteStaffUseCase } from '../../src/application/inviteStaff.js';
import { resendStaffInvitation } from '../../src/application/resendStaffInvitation.js';
import { activateStaffAccount } from '../../src/application/activateStaffAccount.js';
import { deactivateStaff } from '../../src/application/deactivateStaff.js';
import { editStaff } from '../../src/application/editStaff.js';
import { listStaff } from '../../src/application/listStaff.js';
import { getStaff } from '../../src/application/getStaff.js';
import auth from '../../src/infrastructure/http/middleware/auth.js';
import jwt from 'jsonwebtoken';
import { users, clients, services } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

process.env.JWT_SECRET ??= 'test-secret';

// captura el token crudo del link (spec 009 RF-21: el use case manda una URL `…/activar?token=…`) que le manda al "email"
const spyEmail = () => {
  const links = [];
  return { sendInvitation: async ({ to, link }) => { links.push({ to, link: new URL(link).searchParams.get('token') }); }, links };
};

const repos = (email) => ({
  users: userRepo,
  invitationTokens: staffInvitationTokenRepo,
  appointments: appointmentRepo,
  email,
});

const owner = { id: 'own', role: 'owner' };

// spec 008 RF-4: el caso de uso recibe el `body` crudo; estos tests arman campos sueltos, así que se adaptan acá.
// spec 009 RF-21: además recibe `appUrl`, base del enlace de activación.
const inviteStaff = (db, { accountId, actor, name, email, commissionRate }, repos) =>
  inviteStaffUseCase(db, { accountId, actor, body: { name, email, commission_rate: commissionRate }, appUrl: 'http://app.test' }, repos);

const staffActor = { id: 'stf', role: 'staff' };

test('T26 — alta → activar → login', () =>
  withAccount(async (account) => {
    const email = spyEmail();
    const { user, action } = await inviteStaff(db, {
      accountId: account.id, actor: owner, name: 'Ana', email: 'ana@test.com', commissionRate: 0.4,
    }, repos(email));

    assert.equal(action, 'create'); // RF-1
    assert.equal(user.status, 'pendiente');
    assert.equal(email.links.length, 1);

    const { user: activated } = await activateStaffAccount(db, {
      token: email.links[0].link, password: 'clave12345',
    }, repos(email));
    assert.equal(activated.status, 'activo'); // RF-11

    const found = await userRepo.findByEmail(db, 'ana@test.com');
    assert.equal(found.status, 'activo');
    assert.ok(found.password_hash);
  }));

test('T27 — reenvío automático (pendiente, misma cuenta) y explícito invalidan el anterior', () =>
  withAccount(async (account) => {
    const email = spyEmail();
    const first = await inviteStaff(db, {
      accountId: account.id, actor: owner, name: 'Bruno', email: 'bruno@test.com',
    }, repos(email));
    const firstLink = email.links[0].link;

    const second = await inviteStaff(db, {
      accountId: account.id, actor: owner, name: 'Bruno V2', email: 'bruno@test.com',
    }, repos(email));
    assert.equal(second.action, 'resend'); // RF-8
    assert.equal(second.user.id, first.user.id); // mismo user_id

    await assert.rejects(
      () => activateStaffAccount(db, { token: firstLink, password: 'clave12345' }, repos(email)),
      { status: 410 },
    );

    const secondLink = email.links[1].link;
    await resendStaffInvitation(db, { id: first.user.id, accountId: account.id, actor: owner, appUrl: 'http://app.test' }, repos(email));
    await assert.rejects(
      () => activateStaffAccount(db, { token: secondLink, password: 'clave12345' }, repos(email)),
      { status: 410 }, // RF-9/RF-10: el reenvío explícito invalidó también el de resend
    );
    const thirdLink = email.links[2].link;
    const { user } = await activateStaffAccount(db, { token: thirdLink, password: 'clave12345' }, repos(email));
    assert.equal(user.status, 'activo'); // RF-12
  }));

test('T28 — baja cancela turnos y bloqueos futuros, no toca lo pasado; repetir → 422', () =>
  withAccount(async (account) => {
    const email = spyEmail();
    const { user: staff } = await inviteStaff(db, {
      accountId: account.id, actor: owner, name: 'Caro', email: 'caro@test.com',
    }, repos(email));
    await activateStaffAccount(db, { token: email.links[0].link, password: 'clave12345' }, repos(email));

    const now = new Date();
    const client = await db.insert(clients).values({ account_id: account.id, name: 'Cli', email: `c-${crypto.randomUUID()}@t.com` }).returning().then(r => r[0]);
    const service = await db.insert(services).values({ account_id: account.id, name: 'Svc', duration_minutes: 30, price: '10.00' }).returning().then(r => r[0]);
    const refs = { client_id: client.id, service_id: service.id };

    const futureAppt = await appointmentRepo.create(db, {
      account_id: account.id, assigned_user_id: staff.id, status: 'agendado', ...refs,
      scheduled_at: new Date(now.getTime() + 3600_000), scheduled_until: new Date(now.getTime() + 7200_000),
    });
    const futureBlock = await appointmentRepo.create(db, {
      account_id: account.id, assigned_user_id: staff.id, status: 'bloqueado',
      scheduled_at: new Date(now.getTime() + 10800_000), scheduled_until: new Date(now.getTime() + 14400_000),
    });
    const pastCompleted = await appointmentRepo.create(db, {
      account_id: account.id, assigned_user_id: staff.id, status: 'completado', ...refs,
      scheduled_at: new Date(now.getTime() - 14400_000), scheduled_until: new Date(now.getTime() - 10800_000),
    });

    await deactivateStaff(db, { id: staff.id, accountId: account.id, actor: owner, now }, repos(email));

    assert.equal((await appointmentRepo.findById(db, futureAppt.id)).status, 'cancelado'); // RF-26
    assert.equal((await appointmentRepo.findById(db, futureBlock.id)).status, 'cancelado');
    assert.equal((await appointmentRepo.findById(db, pastCompleted.id)).status, 'completado'); // RF-27

    await assert.rejects(
      () => deactivateStaff(db, { id: staff.id, accountId: account.id, actor: owner, now }, repos(email)),
      { status: 422 }, // RF-28
    );
  }));

test('T29 — un usuario dado de baja pierde el acceso en la siguiente request (401)', () =>
  withAccount(async (account) => {
    const email = spyEmail();
    const { user: staff } = await inviteStaff(db, {
      accountId: account.id, actor: owner, name: 'Dani', email: 'dani@test.com',
    }, repos(email));
    await activateStaffAccount(db, { token: email.links[0].link, password: 'clave12345' }, repos(email));

    const token = jwt.sign({ id: staff.id, account_id: account.id, role: 'staff' }, process.env.JWT_SECRET);
    await deactivateStaff(db, { id: staff.id, accountId: account.id, actor: owner, now: new Date() }, repos(email));

    const req = { headers: { authorization: `Bearer ${token}` } };
    let statusSent;
    const res = { status: (s) => { statusSent = s; return res; }, json: () => {} };
    await auth(req, res, () => { throw new Error('next() no debería llamarse'); });

    assert.equal(statusSent, 401); // RF-30
  }));

test('T30 — CHECK de comisión en DB y matriz de email duplicado', () =>
  withAccount(async (account) => {
    await assert.rejects(
      () => db.insert(users).values({
        account_id: account.id, name: 'X', email: `x-${crypto.randomUUID()}@t.com`,
        role: 'staff', commission_rate: '1.5000',
      }),
      (err) => err.cause?.constraint === 'users_commission_rate_check', // RF-4, principio 2
    );

    const email = spyEmail();
    await withAccount(async (otherAccount) => {
      const activeElsewhere = await db.insert(users).values({
        account_id: otherAccount.id, name: 'Activo Otra Cuenta', email: 'compartido@test.com',
        role: 'staff', status: 'activo', password_hash: 'x',
      }).returning().then(r => r[0]);

      await assert.rejects(
        () => inviteStaff(db, { accountId: account.id, actor: owner, name: 'Y', email: 'compartido@test.com' }, repos(email)),
        { status: 409 }, // RF-6: activo en otra cuenta
      );

      await userRepo.update(db, activeElsewhere.id, { status: 'inactivo' });
      await assert.rejects(
        () => inviteStaff(db, { accountId: account.id, actor: owner, name: 'Y', email: 'compartido@test.com' }, repos(email)),
        { status: 409 }, // RF-6: inactivo de otra cuenta, no se libera
      );
    });
  }));

test('T31 — alcance por rol: 404 fuera de cuenta/compañero ajeno, 403 en acciones de owner', () =>
  withAccount(async (account) => {
    const email = spyEmail();
    const { user: staff } = await inviteStaff(db, {
      accountId: account.id, actor: owner, name: 'Eli', email: 'eli@test.com',
    }, repos(email));

    await assert.rejects(
      () => getStaff(db, { id: staff.id, accountId: crypto.randomUUID(), actor: owner }, repos(email)),
      { status: 404 }, // RF-34
    );
    await assert.rejects(
      () => editStaff(db, { id: staff.id, accountId: account.id, actor: staffActor, body: { name: 'x' } }, repos(email)),
      { status: 404 }, // RF-24
    );
    await assert.rejects(
      () => inviteStaff(db, { accountId: account.id, actor: staffActor, name: 'Z', email: 'z@test.com' }, repos(email)),
      { status: 403 }, // RF-14
    );
    await assert.rejects(
      () => deactivateStaff(db, { id: staff.id, accountId: account.id, actor: staffActor }, repos(email)),
      { status: 403 }, // RF-29
    );
    await assert.rejects(
      () => listStaff(db, { accountId: account.id, actor: staffActor }, repos(email)),
      { status: 403 }, // RF-33
    );
  }));

test('T32 — password_hash null para un pendiente no viola ninguna constraint', () =>
  withAccount(async (account) => {
    const inserted = await db.insert(users).values({
      account_id: account.id, name: 'Pend', email: `pend-${crypto.randomUUID()}@t.com`,
      role: 'staff', status: 'pendiente',
    }).returning().then(r => r[0]);
    assert.equal(inserted.password_hash, null);
  }));
