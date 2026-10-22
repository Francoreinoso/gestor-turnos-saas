# Tasks 004 — Disponibilidad semanal del profesional

Deriva de `plan.md`. Tareas de <30 min, en orden de dependencia. Cada una con
sus RF y una condición verificable. TDD: donde dice "test que falla", ese
test se escribe y se ve fallar antes de implementar.

## Fase 0 — Setup y migración

- [x] **T00 · Migración `0006` + schema** — RF-6, RF-8, RF-9 (infraestructura)
  La rama `spec/004-disponibilidad-profesional` ya existe. En `db/schema.js`: `.check()` de `availability_day_of_week_range` y `availability_start_before_end` (patrón de `services_duration_positive`). Escribir a mano `db/migrations/0006_spec_004_availability_constraints.sql` (`btree_gist`, los dos `CHECK`, tipo `timerange`, `EXCLUDE availability_no_overlap`) y sumar la entrada en `meta/_journal.json`.
  **Hecho cuando:** `npm run db:migrate` sobre una DB vacía aplica `0000`..`0006` sin error; en psql, `\d availability` muestra cada una de las tres constraints exactamente una vez (si aparece duplicada, quitar la copia sobrante, como en spec 002 T00).

## Fase 1 — Dominio (puro, sin dependencias)

- [x] **T01 · `domain/availabilityWindows.js` — horas y formato** — RF-2, RF-7
  Test que falla en `tests/domain/availabilityWindows.test.js`, luego `timeToMinutes` y `formatTime`.
  **Hecho cuando:** el test cubre `09:00`→540, `23:59` válido, `24:00`/`9:00`/`09:00:00`/`abc` → 422, y `formatTime('09:00:00')` → `'09:00'`.

- [x] **T02 · `normalizeWindows` — forma y valores** — RF-4, RF-5, RF-6, RF-8
  Test que falla, luego la validación de forma (400) y de valores (422) y el ordenamiento.
  **Hecho cuando:** el test cubre cuerpo no-lista / ventana no-objeto / campo faltante → 400; `day_of_week` `"1"`, `1.5`, `7`, `-1` → 422; `start >= end` → 422; `[]` → `[]`; resultado ordenado por día e inicio.

- [x] **T03 · `normalizeWindows` — solapamiento** — RF-9
  Test que falla, luego el chequeo de solapamiento por día con intervalos `[inicio, fin)`.
  **Hecho cuando:** `09-13`+`12-15` → 422; ventanas idénticas → 422; `09-13`+`13-17` válidas; mismas horas en días distintos válidas; dos tramos `09-13`+`15-19` válidos.

## Fase 2 — Repositorios

- [x] **T04 · `availabilityRepo` + `userRepo.lockById`** — RF-1, RF-3, RF-4
  Crear `repositories/availability.js` (`findByUser`, `replaceForUser`) y exportarlo en `repositories/index.js`; añadir `lockById` a `repositories/users.js`.
  **Hecho cuando:** un test de integración reemplaza el horario de un usuario dos veces y `findByUser` devuelve sólo el segundo conjunto, ordenado por día/inicio; con `[]` queda sin filas.

- [x] **T05 · `userRepo.findWithAvailability` filtra rol y estado** — RF-17, RF-18
  Test de integración que falla con 4 usuarios con ventana (staff activo, staff `pendiente`, staff `inactivo`, owner); luego añadir `role = 'staff'` y `status = 'activo'`.
  **Hecho cuando:** sólo se devuelve el staff activo, y tras reemplazar su horario la siguiente llamada ya devuelve el nuevo (sin caché).

## Fase 3 — Casos de uso (repos fake, test primero; patrón de `tests/application/getStaff.test.js`)

- [x] **T06 · `getStaffAvailability`** — RF-1, RF-2, RF-13, RF-14, RF-15
  Test que falla en `tests/application/getStaffAvailability.test.js`, luego el caso de uso.
  **Hecho cuando:** el test cubre: otra cuenta → 404; id de owner → 404; staff pidiendo a un compañero → 404; owner y staff-self → 200 con horas `HH:MM`; sin ventanas → `[]`.

- [x] **T07 · `replaceStaffAvailability` — orden de evaluación** — RF-10, RF-11
  Test que falla en `tests/application/replaceStaffAvailability.test.js`, luego alcance → estado → validación.
  **Hecho cuando:** el test cubre: trabajador ajeno + cuerpo inválido → 404; `inactivo` + cuerpo inválido → 422; `pendiente` + cuerpo válido → 200; cuerpo inválido no abre transacción ni llama a `replaceForUser`.

- [x] **T08 · `replaceStaffAvailability` — escritura** — RF-3, RF-4, RF-12
  Test que falla, luego `db.transaction` con `lockById` → `replaceForUser`; traducir `23P01`/`23514` a 422.
  **Hecho cuando:** el test verifica el orden `lockById` antes de `replaceForUser` dentro de la transacción, que ningún repo de `appointments` es invocado, la respuesta es el horario resultante, y un `23P01` simulado produce 422.

## Fase 4 — HTTP

- [x] **T09 · Rutas `GET|PUT /staff/:id/availability`** — RF-1, RF-3, RF-13..RF-16
  En `routes/staff.js`, con `auth`, `wrap` y `actorOf`, delegando en los dos casos de uso; `PUT` responde 200 con el horario.
  **Hecho cuando:** el servidor levanta y un `curl` con JWT de owner a `GET /staff/<id>/availability` devuelve 200 (ver T14).

## Fase 5 — Integración (Postgres real, `withAccount`)

Todos en `tests/integration/staffAvailability.test.js`.

- [x] **T10 · Atomicidad y `EXCLUDE`** — RF-3, RF-9
  Reemplazo con horario previo A cuya inserción falla a mitad (ventana `start > end` pasada directo al repo) → A sigue intacto. Insertar dos ventanas solapadas directo por el repo → error de DB; adyacentes → ok.
  **Hecho cuando:** los 3 escenarios pasan.

- [x] **T11 · Alcance por rol end-to-end** — RF-13..RF-16
  Staff sobre compañero, owner sobre su propio id y usuario de otra cuenta → todos 404 y ninguno 403; owner sobre staff de su cuenta → 200.
  **Hecho cuando:** los 4 escenarios pasan.

- [x] **T12 · Slots, autoasignación y turnos existentes** — RF-12, RF-17, RF-18
  Con los 4 usuarios de T05, `findAvailableProfessional` sólo puede asignar al staff activo; un turno `agendado` fuera de la nueva ventana sigue `agendado` tras el reemplazo.
  **Hecho cuando:** ambos escenarios pasan.

- [x] **T13 · Concurrencia** — RNF concurrencia
  Dos `replaceStaffAvailability` simultáneos (`Promise.all`) sobre el mismo trabajador con horarios distintos.
  **Hecho cuando:** ambos terminan sin error y el horario final es exactamente uno de los dos (nunca una mezcla).

## Fase 6 — Documentación y cierre

- [x] **T14 · Actualizar `docs/diseno-gestor-turnos.md` §4** — impacto fuera de la spec
  Reemplazar el recurso `availability` documentando `GET|PUT /staff/:id/availability` y que `/availability/:business_id` sólo ofrece staff activo.
  **Hecho cuando:** la tabla de rutas coincide con `spec.md` y no contradice los RF.

- [x] **T15 · Gate final** — todos los RF
  `npm test` completo y `npm run db:migrate` sobre DB vacía, ambos verdes. Recorrido manual con `curl` del flujo de "Criterios de finalización" de `spec.md`.
  **Hecho cuando:** ambos comandos salen con código 0 y el recorrido reproduce cada paso (owner invita y staff activa → `PUT` de horario → slots ofrecidos → `PUT []` → sin slots → `PUT` solapado 422 → otro staff 404 → id del owner 404).

---

## Estado: implementado (265/265 tests en verde)

Hallazgos durante la implementación, no previstos en el plan:

- **Test de la spec 003 chocaba con la migración `0006`.** `tests/integration/paymentsSummary.test.js` (T20) afirmaba que no existiera ninguna migración `0006`. Se conservó su intención (la spec 003 no agrega migraciones) comprobando que ningún archivo de migración contenga `spec_003`, en vez de fijar un número.
- **`findScopedStaff`** (`application/findScopedStaff.js`) se extrajo como helper común de los dos casos de uso, para que el alcance 404 viva en un solo lugar. El plan lo repetía en cada uno.
- **Los casos de uso devuelven la lista de ventanas directamente** (no `{ user }` como `getStaff`): la spec habla de "la lista de ventanas" y de "lista vacía".
- **Verificado por mutación:** sin `lockById`, el test de concurrencia falla; con él, pasa.
- **Entorno de verificación:** Postgres 18 embebido (`embedded-postgres`, fuera del proyecto), no 17 como `docker-compose.yml`; `btree_gist` y el `EXCLUDE` funcionaron igual.

Recorrido manual (`curl`, servidor real): owner se registra → invita a Ana → activa con el token → `PUT` de dos tramos del lunes (200) → `GET /availability/:business_id` ofrece 8 slots → `PUT []` → 0 slots → `PUT` solapado → 422 → cuerpo `{}` → 400 → staff `GET` propio → 200 → staff `GET` del owner → 404 → `PUT` sobre el id del owner → 404 → sin token → 401. Con la invitada aún `pendiente`, los slots fueron 0 (RF-17).
