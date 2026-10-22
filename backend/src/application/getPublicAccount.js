import { isUuid } from '../domain/uuid.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

const byName = (a, b) => a.name.localeCompare(b.name, 'es');

// spec 005 RF-1..RF-4 — información pública de un negocio, sin autenticación.
// RF-2: la respuesta se arma campo a campo (lista blanca); agregar una columna a una tabla no la expone.
export const getPublicAccount = async (db, { id }, repos) => {
  if (!isUuid(id)) throw httpErr(404, 'not_found');

  const account = await repos.accounts.findById(db, id);
  if (!account) throw httpErr(404, 'not_found');

  const services = await repos.services.findAll(db, id, { active: true });
  const professionals = await repos.users.findManyByAccount(db, id, { status: 'activo' });

  return {
    id: account.id,
    business_name: account.business_name,
    services: services
      .map(s => ({ id: s.id, name: s.name, duration_minutes: s.duration_minutes, price: s.price }))
      .sort(byName),
    professionals: professionals.map(u => ({ id: u.id, name: u.name })).sort(byName),
  };
};
