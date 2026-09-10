-- spec 001 (T4 / RF-46): al cancelar un bloqueo con baja lógica, la fila queda
-- con status='cancelado' y client_id/service_id NULL — el CHECK original (0001) lo
-- rechazaba. Se relaja para no exigir referencias en filas canceladas, manteniendo
-- la exigencia para bloqueos activos y para turnos en cualquier estado no terminal.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_nullable_fields_check";

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_nullable_fields_check" CHECK (
  (status = 'bloqueado' AND client_id IS NULL AND service_id IS NULL)
  OR
  (status = 'cancelado')
  OR
  (status NOT IN ('bloqueado', 'cancelado')
    AND client_id IS NOT NULL AND service_id IS NOT NULL AND assigned_user_id IS NOT NULL)
);
