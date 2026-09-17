-- spec 002: estado de usuario (pendiente/activo/inactivo), contraseña opcional
-- mientras está pendiente, y tokens de invitación de un solo uso.
-- RF-4 (rango [0,1] de commission_rate) ya está reforzado en la DB por el CHECK
-- "users_commission_rate_check" de la migración 0002 — no se duplica acá.

CREATE TYPE "user_status" AS ENUM ('pendiente', 'activo', 'inactivo');

ALTER TABLE "users" ADD COLUMN "status" user_status NOT NULL DEFAULT 'activo';
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

CREATE TABLE "staff_invitation_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "staff_invitation_tokens_user_id_idx" ON "staff_invitation_tokens" ("user_id");
CREATE INDEX "staff_invitation_tokens_token_hash_idx" ON "staff_invitation_tokens" ("token_hash");
