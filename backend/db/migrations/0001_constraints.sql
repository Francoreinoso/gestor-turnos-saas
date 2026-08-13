-- clients: unique functional index on lower(email) + phone, and contact check
CREATE UNIQUE INDEX "clients_email_unique" ON "clients" (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX "clients_phone_unique" ON "clients" (phone) WHERE phone IS NOT NULL;
ALTER TABLE "clients" ADD CONSTRAINT "clients_contact_check"
  CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- appointments: conditional nullability
-- bloqueado rows have no client/service; all others must have both + an assigned user
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_nullable_fields_check" CHECK (
  (status = 'bloqueado' AND client_id IS NULL AND service_id IS NULL)
  OR
  (status != 'bloqueado' AND client_id IS NOT NULL AND service_id IS NOT NULL AND assigned_user_id IS NOT NULL)
);

-- appointments: overlap prevention via trigger
-- EXCLUSION CONSTRAINT can't handle the OR logic needed for business-wide blocks
-- (NULL assigned_user_id must conflict with every other appointment in the account)
CREATE OR REPLACE FUNCTION check_appointment_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM appointments
    WHERE account_id = NEW.account_id
      AND status != 'cancelado'
      AND id != NEW.id
      AND (
        assigned_user_id = NEW.assigned_user_id
        OR assigned_user_id IS NULL
        OR NEW.assigned_user_id IS NULL
      )
      AND scheduled_at < NEW.scheduled_until
      AND NEW.scheduled_at < scheduled_until
  ) THEN
    RAISE EXCEPTION 'appointment_overlap';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointment_overlap_check
BEFORE INSERT OR UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION check_appointment_overlap();
