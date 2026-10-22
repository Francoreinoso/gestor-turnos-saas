import { eq, and, asc } from 'drizzle-orm';
import { users, availability } from '../../../../db/schema.js';

export const userRepo = {
  findByEmail: (db, email) =>
    db.query.users.findFirst({ where: eq(users.email, email) }),

  findById: (db, id) =>
    db.query.users.findFirst({ where: eq(users.id, id) }),

  create: (db, data) =>
    db.insert(users).values(data).returning().then(r => r[0]),

  update: (db, id, data) =>
    db.update(users).set(data).where(eq(users.id, id)).returning().then(r => r[0]),

  // spec 002 RF-24, RF-34: un trabajador de la cuenta, para ver/editar/dar de baja.
  findVisible: (db, { id, accountId }) =>
    db.query.users.findFirst({ where: and(eq(users.id, id), eq(users.account_id, accountId)) }),

  // spec 002 RF-31, RF-32: listado de trabajadores de la cuenta, orden alfabético, filtro opcional de estado.
  findManyByAccount: (db, accountId, { status } = {}) => {
    const conditions = [eq(users.account_id, accountId), eq(users.role, 'staff')];
    if (status) conditions.push(eq(users.status, status));
    return db.query.users.findMany({
      where: and(...conditions),
      orderBy: asc(users.name),
    });
  },

  // spec 004 RNF concurrencia: serializa los reemplazos de horario del mismo trabajador. Solo dentro de una transacción.
  lockById: (tx, id) =>
    tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for('update').then(r => r[0]),

  // Returns users with their availability for a given account, optionally filtered by id.
  // spec 004 RF-17: solo trabajadores (staff) activos — el owner no atiende, pendiente/inactivo no se ofrecen.
  findWithAvailability: (db, accountId, userId = null) => {
    const conditions = [eq(users.account_id, accountId), eq(users.role, 'staff'), eq(users.status, 'activo')];
    if (userId) conditions.push(eq(users.id, userId));
    return db.query.users.findMany({
      where: and(...conditions),
      with: { availability: true },
    });
  },
};
