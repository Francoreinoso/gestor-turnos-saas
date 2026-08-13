import { pgTable, pgEnum, uuid, varchar, text, integer, numeric, boolean, timestamp, time } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['owner', 'staff']);
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'bloqueado', 'agendado', 'en_progreso', 'completado', 'no_llego', 'cancelado',
]);

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  business_name: varchar('business_name', { length: 255 }).notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password_hash: varchar('password_hash', { length: 255 }).notNull(),
  role: roleEnum('role').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  notes: text('notes'),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const services = pgTable('services', {
  id: uuid('id').primaryKey().defaultRandom(),
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  duration_minutes: integer('duration_minutes').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  active: boolean('active').notNull().default(true),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const servicePriceHistories = pgTable('service_price_histories', {
  id: uuid('id').primaryKey().defaultRandom(),
  service_id: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  changed_at: timestamp('changed_at').notNull().defaultNow(),
});

export const availability = pgTable('availability', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // ponytail: weekly recurrence only — exception dates (holidays, vacation) are a future feature
  day_of_week: integer('day_of_week').notNull(), // 0=Sunday, 6=Saturday
  start_time: time('start_time').notNull(),
  end_time: time('end_time').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Denormalized intentionally — avoids extra joins on frequent availability/listing queries
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  client_id: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  service_id: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
  // NULL means whole-business block when status='bloqueado'
  assigned_user_id: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
  scheduled_at: timestamp('scheduled_at').notNull(),
  scheduled_until: timestamp('scheduled_until').notNull(),
  status: appointmentStatusEnum('status').notNull(),
  notes: text('notes'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const appointmentAccessTokens = pgTable('appointment_access_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  appointment_id: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
  // SHA-256 of the actual token — raw token never stored
  token_hash: varchar('token_hash', { length: 64 }).notNull(),
  expires_at: timestamp('expires_at').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});
