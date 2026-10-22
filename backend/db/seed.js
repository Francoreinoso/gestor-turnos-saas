import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { fileURLToPath } from 'url';
import * as schema from './schema.js';
import * as defaultRepos from '../src/infrastructure/db/repositories/index.js';
import { createAppointmentFromPanel } from '../src/application/createAppointmentFromPanel.js';
import { replaceStaffAvailability } from '../src/application/replaceStaffAvailability.js';

// spec 006 RF-19: identificador fijo, así el enlace de reserva de la demo es siempre el mismo.
export const DEMO_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const DEMO_PASSWORD = 'demo1234';

const isWeekday = (d) => d.getDay() >= 1 && d.getDay() <= 5;

// spec 006 RF-28: el k-ésimo día hábil estrictamente posterior al día de `now` (hora local, a medianoche).
export const nextBusinessDay = (now, k) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let found = 0; found < k;) {
    d.setDate(d.getDate() + 1);
    if (isWeekday(d)) found++;
  }
  return d;
};

// Simétrica de nextBusinessDay hacia atrás, para el historial de turnos completados.
export const prevBusinessDay = (now, k) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let found = 0; found < k;) {
    d.setDate(d.getDate() - 1);
    if (isWeekday(d)) found++;
  }
  return d;
};

const at = (day, hours, minutes = 0) => {
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

// Horario semanal de lunes a viernes; los tramos de los dos profesionales se solapan en parte (11-13 y 14-17).
const WEEKDAYS = [1, 2, 3, 4, 5];
const SCHEDULES = {
  lucia: [['09:00', '13:00'], ['14:00', '17:00']],
  martin: [['11:00', '19:00']],
};
const weeklyWindows = (ranges) =>
  WEEKDAYS.flatMap(day_of_week => ranges.map(([start_time, end_time]) => ({ day_of_week, start_time, end_time })));

export const assertNotProduction = (env) => {
  if (env.NODE_ENV === 'production') throw new Error('El seed no se ejecuta con NODE_ENV=production');
};

// spec 006 RF-19..RF-28 — la cuenta demo, creada con los casos de uso y los repositorios (nunca SQL a mano).
// Todo ocurre en una transacción (RF-23). `accountId` y `emailPrefix` existen para que los tests no pisen la demo real.
export const seedDemo = async (db, {
  now = new Date(),
  accountId = DEMO_ACCOUNT_ID,
  emailPrefix = 'demo',
  ifMissing = false,
  env = process.env,
  repos = defaultRepos,
} = {}) => {
  assertNotProduction(env);

  return db.transaction(async (tx) => {
    const existing = await repos.accounts.findById(tx, accountId);
    if (existing && ifMissing) return { skipped: true };
    if (existing) await tx.delete(schema.accounts).where(eq(schema.accounts.id, accountId)); // el ON DELETE CASCADE limpia el resto

    await tx.insert(schema.accounts).values({ id: accountId, business_name: 'Peluquería Demo', commission_rate: '0.3000' });

    const password_hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const newUser = (name, key, role, commission_rate) =>
      repos.users.create(tx, {
        account_id: accountId, name, email: `${emailPrefix}.${key}@example.com`, password_hash, role, status: 'activo', commission_rate,
      });
    const owner = await newUser('Ana Demo (owner)', 'owner', 'owner', null);
    const lucia = await newUser('Lucía Fernández', 'lucia', 'staff', '0.4000');
    const martin = await newUser('Martín Gómez', 'martin', 'staff', '0.5000');
    const actor = { id: owner.id, role: 'owner' };

    // Un servicio cambia de precio, para que su historial tenga dos entradas.
    const newService = async (name, duration_minutes, price) => {
      const service = await repos.services.create(tx, { account_id: accountId, name, duration_minutes, price });
      await repos.services.addPriceHistory(tx, service.id, price);
      return service;
    };
    const corte = await newService('Corte de pelo', 45, '7000.00');
    await repos.services.update(tx, corte.id, { price: '8500.00' });
    await repos.services.addPriceHistory(tx, corte.id, '8500.00');
    const coloracion = await newService('Coloración', 90, '25000.00');
    const brushing = await newService('Brushing', 30, '6000.00');
    const services = [corte, coloracion, brushing];

    for (const [user, key] of [[lucia, 'lucia'], [martin, 'martin']]) {
      await replaceStaffAvailability(tx, { id: user.id, accountId, actor, body: weeklyWindows(SCHEDULES[key]) }, repos);
    }

    const clients = [];
    // email y teléfono son únicos en toda la base: el email lleva el prefijo y se omite el teléfono.
    for (const [name, key] of [
      ['Camila Rossi', 'camila'], ['Diego Herrera', 'diego'], ['Valentina Paz', 'valentina'], ['Tomás Aguirre', 'tomas'],
    ]) clients.push(await repos.clients.create(tx, { account_id: accountId, name, email: `${emailPrefix}.${key}@example.com` }));

    const book = (scheduledAt, employee, service, client) => createAppointmentFromPanel(tx, {
      accountId, actor, serviceId: service.id, scheduledAt: scheduledAt.toISOString(), clientId: client.id, employeeId: employee.id,
    }, repos);

    // 8 completados en los días hábiles anteriores; un profesional por día, a una hora dentro de su jornada.
    for (let i = 0; i < 8; i++) {
      const day = prevBusinessDay(now, i + 1);
      const [employee, hour] = i % 2 === 0 ? [lucia, 10] : [martin, 15];
      await book(at(day, hour), employee, services[i % 3], clients[i % 4]);
    }

    // 5 agendados en los próximos días hábiles, completos dentro de la ventana del profesional.
    let managePath;
    for (let k = 1; k <= 5; k++) {
      const day = nextBusinessDay(now, k);
      const [employee, hour, minute] = k % 2 === 1 ? [lucia, 9, 30] : [martin, 16, 0];
      const { appointment, access_token } = await book(at(day, hour, minute), employee, services[k % 3], clients[k % 4]);
      if (k === 1) managePath = `/turno/${appointment.id}?token=${access_token}`;
    }

    // 1 cancelado: nace agendado y pasa a cancelado.
    const toCancel = await book(at(nextBusinessDay(now, 2), 12), martin, corte, clients[0]);
    await repos.appointments.update(tx, toCancel.appointment.id, { status: 'cancelado' });

    // 1 bloqueo futuro de todo el negocio.
    const blockDay = nextBusinessDay(now, 6);
    await repos.appointments.create(tx, {
      account_id: accountId, assigned_user_id: null, status: 'bloqueado',
      scheduled_at: at(blockDay, 9), scheduled_until: at(blockDay, 19), notes: 'Feriado local',
    });

    const credentials = (user) => ({ name: user.name, email: user.email, password: DEMO_PASSWORD });
    return {
      accountId,
      owner: credentials(owner),
      staff: [credentials(lucia), credentials(martin)],
      bookingPath: `/reservar/${accountId}`,
      managePath,
    };
  });
};

// spec 006 RF-24..RF-26 — línea de comandos: `node db/seed.js [--if-missing]`.
const run = async () => {
  assertNotProduction(process.env);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const db = drizzle(pool, { schema });
    const { rows } = await pool.query(
      `select to_regclass('public.accounts') as accounts, to_regclass('drizzle.__drizzle_migrations') as migrations`,
    );
    if (!rows[0].accounts || !rows[0].migrations) {
      throw new Error('La base no tiene las migraciones aplicadas: ejecuta npm run db:migrate primero');
    }

    const result = await seedDemo(db, { ifMissing: process.argv.includes('--if-missing') });
    if (result.skipped) return console.log('La cuenta demo ya existe: no se modifica nada (--if-missing)');

    const base = process.env.FRONTEND_URL || 'http://localhost:5173';
    console.log('Cuenta demo creada');
    for (const [rol, u] of [['owner', result.owner], ['staff', result.staff[0]], ['staff', result.staff[1]]]) {
      console.log(`  ${rol.padEnd(5)} ${u.email} / ${u.password}`);
    }
    console.log(`Reserva pública:  ${base}${result.bookingPath}`);
    console.log(`Gestión de turno: ${base}${result.managePath}`);
  } finally {
    await pool.end();
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
