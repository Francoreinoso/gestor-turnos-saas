-- spec 011: propuestas de reserva del asistente y códigos de verificación por teléfono.
-- Invariantes en la base (principio 2): una sola propuesta pendiente por cliente, servicio, profesional e
-- inicio (índice único parcial); una confirmada siempre apunta a su turno; a lo sumo 5 intentos por código.

CREATE TYPE "assistant_proposal_status" AS ENUM ('pendiente', 'confirmada', 'descartada', 'vencida');

CREATE TABLE "assistant_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "starts_at" timestamp NOT NULL,
  "status" assistant_proposal_status NOT NULL DEFAULT 'pendiente',
  -- Sin acción ON DELETE: los turnos no se borran (principio 5); al borrar la cuenta cae todo por cascada.
  "appointment_id" uuid REFERENCES "appointments"("id"),
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "assistant_proposals_confirmed_has_appointment" CHECK (status <> 'confirmada' OR appointment_id IS NOT NULL)
);
CREATE UNIQUE INDEX "assistant_proposals_one_pending_idx"
  ON "assistant_proposals" ("client_id", "service_id", "employee_id", "starts_at")
  WHERE status = 'pendiente';

CREATE TABLE "assistant_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "phone" varchar(20) NOT NULL,
  -- SHA-256 del código; el código en claro nunca se guarda.
  "code_hash" varchar(64) NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "expires_at" timestamp NOT NULL,
  -- NULL = todavía válido; se fija al usarse, al agotar los intentos o al pedirse un código nuevo.
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "assistant_codes_attempts_range" CHECK (attempts BETWEEN 0 AND 5)
);
CREATE INDEX "assistant_codes_account_phone_idx" ON "assistant_codes" ("account_id", "phone", "created_at");
