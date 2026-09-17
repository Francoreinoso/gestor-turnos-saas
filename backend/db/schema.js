import { pgTable, pgEnum, uuid, varchar, text, integer, numeric, boolean, timestamp, time, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const roleEnum = pgEnum('role', ['owner', 'staff']);
export const userStatusEnum = pgEnum('user_status', ['pendiente', 'activo', 'inactivo']);
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'bloqueado', 'agendado', 'en_progreso', 'completado', 'no_llego', 'cancelado',
]);

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  business_name: varchar('business_name', { length: 255 }).notNull(),
  commission_rate: numeric('commission_rate', { precision: 5, scale: 4 }),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  // NULL mientras status='pendiente' — un trabajador invitado todavía no definió contraseña (spec 002 RF-1)
  password_hash: varchar('password_hash', { length: 255 }),
  role: roleEnum('role').notNull(),
  status: userStatusEnum('status').notNull().default('activo'),
  // Rango [0,1] ya reforzado en la DB por "users_commission_rate_check" (migración 0002) — RF-4 no necesita un CHECK nuevo.
  commission_rate: numeric('commission_rate', { precision: 5, scale: 4 }),
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
}, (table) => ({
  durationPositive: check('services_duration_positive', sql`${table.duration_minutes} > 0`),
}));

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

export const staffInvitationTokens = pgTable('staff_invitation_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // SHA-256 of the actual token — raw token never stored
  token_hash: varchar('token_hash', { length: 64 }).notNull(),
  expires_at: timestamp('expires_at').notNull(),
  // NULL = todavía válido; set al activarse o al ser invalidado por una invitación más nueva (spec 002 RF-8/RF-12)
  used_at: timestamp('used_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  appointment_id: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'restrict' }),
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  assigned_user_id: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  commission_rate_applied: numeric('commission_rate_applied', { precision: 5, scale: 4 }),
  employee_amount: numeric('employee_amount', { precision: 10, scale: 2 }),
  business_amount: numeric('business_amount', { precision: 10, scale: 2 }),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

// ── Relations ──────────────────────────────────────────────────────────────────

export const accountsRelations = relations(accounts, ({ many }) => ({
  users: many(users),
  appointments: many(appointments),
  payments: many(payments),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  account: one(accounts, { fields: [users.account_id], references: [accounts.id] }),
  availability: many(availability),
  appointments: many(appointments, { relationName: 'assignedUser' }),
  invitationTokens: many(staffInvitationTokens),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  account: one(accounts, { fields: [clients.account_id], references: [accounts.id] }),
  appointments: many(appointments),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  account: one(accounts, { fields: [services.account_id], references: [accounts.id] }),
  priceHistories: many(servicePriceHistories),
  appointments: many(appointments),
}));

export const servicePriceHistoriesRelations = relations(servicePriceHistories, ({ one }) => ({
  service: one(services, { fields: [servicePriceHistories.service_id], references: [services.id] }),
}));

export const availabilityRelations = relations(availability, ({ one }) => ({
  user: one(users, { fields: [availability.user_id], references: [users.id] }),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  client: one(clients, { fields: [appointments.client_id], references: [clients.id] }),
  service: one(services, { fields: [appointments.service_id], references: [services.id] }),
  assignedUser: one(users, {
    fields: [appointments.assigned_user_id],
    references: [users.id],
    relationName: 'assignedUser',
  }),
  payment: one(payments, { fields: [appointments.id], references: [payments.appointment_id] }),
}));

export const appointmentAccessTokensRelations = relations(appointmentAccessTokens, ({ one }) => ({
  appointment: one(appointments, { fields: [appointmentAccessTokens.appointment_id], references: [appointments.id] }),
}));

export const staffInvitationTokensRelations = relations(staffInvitationTokens, ({ one }) => ({
  user: one(users, { fields: [staffInvitationTokens.user_id], references: [users.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  appointment: one(appointments, { fields: [payments.appointment_id], references: [appointments.id] }),
  assignedUser: one(users, { fields: [payments.assigned_user_id], references: [users.id] }),
}));
