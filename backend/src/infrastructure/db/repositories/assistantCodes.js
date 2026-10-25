import { eq, and, isNull, gt, gte, desc, sql, count } from 'drizzle-orm';
import { assistantCodes } from '../../../../db/schema.js';

// spec 011 RF-1..RF-4 — códigos de verificación de un solo uso, por cuenta y teléfono.
export const assistantCodeRepo = {
  // created_at se fija desde la aplicación: countSince lo compara con fechas de Node, y en una columna sin zona
  // el now() de Postgres usa la zona del servidor de base, que puede no coincidir.
  create: (db, data) =>
    db.insert(assistantCodes).values({ created_at: new Date(), ...data }).returning().then(r => r[0]),

  // El último sin usar y sin vencer.
  findActive: (db, { accountId, phone, now = new Date() }) =>
    db.query.assistantCodes.findFirst({
      where: and(
        eq(assistantCodes.account_id, accountId),
        eq(assistantCodes.phone, phone),
        isNull(assistantCodes.used_at),
        gt(assistantCodes.expires_at, now),
      ),
      orderBy: desc(assistantCodes.created_at),
    }),

  // Al pedir un código nuevo, los anteriores dejan de valer.
  invalidateActive: (db, { accountId, phone }) =>
    db.update(assistantCodes)
      .set({ used_at: new Date() })
      .where(and(eq(assistantCodes.account_id, accountId), eq(assistantCodes.phone, phone), isNull(assistantCodes.used_at))),

  // RF-3: suma un intento fallido; al llegar a `maxAttempts` el código queda invalidado.
  registerFailure: (db, id, maxAttempts) =>
    db.update(assistantCodes)
      .set({
        attempts: sql`${assistantCodes.attempts} + 1`,
        used_at: sql`CASE WHEN ${assistantCodes.attempts} + 1 >= ${maxAttempts} THEN now() ELSE ${assistantCodes.used_at} END`,
      })
      .where(and(eq(assistantCodes.id, id), isNull(assistantCodes.used_at)))
      .returning()
      .then(r => r[0]),

  // Un solo uso aun con verificaciones concurrentes: solo una actualización encuentra used_at en NULL.
  consume: (db, id) =>
    db.update(assistantCodes)
      .set({ used_at: new Date() })
      .where(and(eq(assistantCodes.id, id), isNull(assistantCodes.used_at)))
      .returning()
      .then(r => r[0]),

  // RF-4: códigos pedidos para ese teléfono desde `since`.
  countSince: (db, { accountId, phone, since }) =>
    db.select({ n: count() }).from(assistantCodes)
      .where(and(eq(assistantCodes.account_id, accountId), eq(assistantCodes.phone, phone), gte(assistantCodes.created_at, since)))
      .then(r => r[0].n),
};
