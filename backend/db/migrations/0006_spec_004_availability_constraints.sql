-- spec 004: invariantes del horario semanal (RF-6, RF-8, RF-9).
-- El EXCLUDE usa un tipo de rango propio sobre `time`: es semiabierto [inicio, fin),
-- así que dos ventanas adyacentes (fin = inicio) no chocan.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "availability"
  ADD CONSTRAINT "availability_day_of_week_range" CHECK (day_of_week BETWEEN 0 AND 6),
  ADD CONSTRAINT "availability_start_before_end" CHECK (start_time < end_time);

CREATE TYPE "timerange" AS RANGE (subtype = time);

ALTER TABLE "availability"
  ADD CONSTRAINT "availability_no_overlap"
  EXCLUDE USING gist (
    user_id WITH =,
    day_of_week WITH =,
    timerange(start_time, end_time) WITH &&
  );
