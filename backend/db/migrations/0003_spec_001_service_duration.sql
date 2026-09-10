-- spec 001 (RF-12): la duración de un servicio debe ser positiva.
-- Respalda en la DB la validación de dominio de computeEndsAt.
ALTER TABLE "services" ADD CONSTRAINT "services_duration_positive" CHECK (duration_minutes > 0);
