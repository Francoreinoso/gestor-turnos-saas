-- spec 011 RF-19 (T2b): teléfono y email de clients son únicos dentro de cada cuenta, no en toda la base.
-- La 0001 los hizo globales, y una persona no podía ser cliente de dos negocios. La 0001 no se edita (principio 8):
-- esta migración reemplaza sus índices. Los datos existentes ya cumplen la regla nueva, que es menos estricta.

DROP INDEX "clients_email_unique";
DROP INDEX "clients_phone_unique";

CREATE UNIQUE INDEX "clients_account_email_unique" ON "clients" ("account_id", lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX "clients_account_phone_unique" ON "clients" ("account_id", phone) WHERE phone IS NOT NULL;
