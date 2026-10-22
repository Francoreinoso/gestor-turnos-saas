import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPublicAccount } from '../../src/application/getPublicAccount.js';

const ID = '3f2b8c1e-5d4a-4e6f-9a1b-0c2d3e4f5a6b';
const db = {};

const makeRepos = (o = {}) => ({
  accounts: { findById: async () => ({ id: ID, business_name: 'Barbería Sur', commission_rate: '0.1000', owner_email: 'x@y.com' }), ...o.accounts },
  services: { findAll: async () => [], ...o.services },
  users: { findManyByAccount: async () => [], ...o.users },
});

test('RF-3: id que no es UUID → 404 sin tocar ningún repo', async () => {
  const touched = [];
  const spy = (name) => async () => { touched.push(name); return undefined; };
  const repos = makeRepos({ accounts: { findById: spy('accounts') }, services: { findAll: spy('services') }, users: { findManyByAccount: spy('users') } });

  await assert.rejects(() => getPublicAccount(db, { id: 'no-es-uuid' }, repos), { message: 'not_found', status: 404 });
  assert.deepEqual(touched, []);
});

test('RF-3: cuenta inexistente → 404', async () => {
  const repos = makeRepos({ accounts: { findById: async () => undefined } });
  await assert.rejects(() => getPublicAccount(db, { id: ID }, repos), { message: 'not_found', status: 404 });
});

test('RF-2: solo expone las claves de la lista blanca aunque los repos devuelvan columnas extra', async () => {
  const repos = makeRepos({
    services: { findAll: async () => [{ id: 's1', account_id: ID, name: 'Corte', duration_minutes: 30, price: '1500.00', active: true, created_at: new Date() }] },
    users: { findManyByAccount: async () => [{ id: 'u1', account_id: ID, name: 'Ana', email: 'ana@x.com', commission_rate: '0.5', password_hash: 'h', status: 'activo', role: 'staff' }] },
  });

  const res = await getPublicAccount(db, { id: ID }, repos);

  assert.deepEqual(Object.keys(res).sort(), ['business_name', 'id', 'professionals', 'services']);
  assert.deepEqual(res.services, [{ id: 's1', name: 'Corte', duration_minutes: 30, price: '1500.00' }]);
  assert.deepEqual(res.professionals, [{ id: 'u1', name: 'Ana' }]);
  assert.equal(res.business_name, 'Barbería Sur');
});

test('RF-1: pide solo servicios activos y profesionales activos', async () => {
  let servicesFilter, usersFilter;
  const repos = makeRepos({
    services: { findAll: async (_db, _id, f) => { servicesFilter = f; return []; } },
    users: { findManyByAccount: async (_db, _id, f) => { usersFilter = f; return []; } },
  });
  await getPublicAccount(db, { id: ID }, repos);
  assert.deepEqual(servicesFilter, { active: true });
  assert.deepEqual(usersFilter, { status: 'activo' });
});

test('RF-1: servicios ordenados por nombre', async () => {
  const svc = (name) => ({ id: name, name, duration_minutes: 30, price: '1' });
  const repos = makeRepos({ services: { findAll: async () => [svc('Tintura'), svc('Barba'), svc('Corte')] } });
  const res = await getPublicAccount(db, { id: ID }, repos);
  assert.deepEqual(res.services.map(s => s.name), ['Barba', 'Corte', 'Tintura']);
});

test('RF-4: sin servicios o sin profesionales → listas vacías, no error', async () => {
  const res = await getPublicAccount(db, { id: ID }, makeRepos());
  assert.deepEqual(res.services, []);
  assert.deepEqual(res.professionals, []);
});
