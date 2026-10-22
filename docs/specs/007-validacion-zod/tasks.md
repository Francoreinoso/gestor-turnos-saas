# Tasks 007 — Validación de entrada con Zod

Deriva de `plan.md`. Tareas de <30 min, en orden de dependencia. Cada una con
sus RF y una condición verificable. TDD: donde dice "test que falla", ese
test se escribe y se ve fallar antes de implementar. Cada endpoint migrado es
un commit pequeño; la caracterización (T01) debe seguir en verde después de cada uno.

## Fase 0 — Setup y red de seguridad

- [ ] **T00 · Dependencia** — principio 1
  La rama `spec/007-validacion-zod` ya existe. `npm install zod` en `backend/` (4.x, con `^`). No se toca el frontend.
  **Hecho cuando:** `package.json` y `package-lock.json` incluyen `zod` y `npm test` sigue en verde.

- [ ] **T01 · Test de caracterización del contrato actual** — RF-4, RF-5, RF-6
  `tests/integration/validationContract.test.js`: tabla `[método, ruta, body/query, estado, código]` con un caso por cada código de forma/formato de la sección 2 del plan, capturado contra el código **actual** (incluye `date_from, date_to, service_id required`). Incluye el orden de evaluación: trabajador ajeno + body inválido → 404; `inactivo` + body inválido → 422; `PATCH /services/:id/prices` sin `price` sobre servicio ajeno → 400 (el `missing_fields` precede al 404).
  **Hecho cuando:** pasa en verde sobre `main` sin tocar código de producción. Si algún caso contradice el plan (p. ej. D-P6), se anota y se corrige el plan antes de seguir.

- [ ] **T02 · Verificar la hipótesis de seguridad (D-P5)** — RF-11
  Test que falla en `tests/integration/inputHardening.test.js`: `POST /public/bookings` y `POST /appointments` con `client: { name, email, account_id: <otra cuenta> }`; el cliente debe quedar en la cuenta correcta.
  **Hecho cuando:** el test falla (confirma el hallazgo) o pasa (se descarta y se corrige el plan; queda como test de regresión).

## Fase 1 — Mecanismo (puro)

- [ ] **T03 · `domain/validation.js`** — RF-2, RF-3, RF-10
  Test que falla en `tests/domain/validation.test.js`, luego `rule(code, status)` y `parseInput(schema, data)`.
  **Hecho cuando:** el test cubre: primer issue determinista con varios fallos; ausente → código de ausencia y tipo incorrecto → código del campo o `invalid_body`; cuerpo `null`/`[]`/string/`undefined` → 400 `invalid_body`; el mensaje de la librería nunca llega al error; `rule('x', 422)` produce estado 422; los refinamientos cruzados no corren si falló el tipo.

- [ ] **T04 · `domain/schemas/common.js`** — RF-9, RF-12, RF-13
  Test que falla en `tests/domain/schemas/common.test.js`, luego `requiredText`, `optionalText`, `email`, `uuidField`, `isoDate`, `phone`, `commissionRate`, `clientData`.
  **Hecho cuando:** el test cubre: `"  "` y `""` → `missing_fields`; `trim` en nombre/notas y **no** en `password`; `email` en minúsculas con el mismo resultado que `normalizeEmail`; `phone` reutiliza `PHONE_REGEX`; `uuidField` acepta lo mismo que `isUuid`; opcional ausente → `undefined`; `clientData` descarta claves desconocidas (incluido `account_id`).

## Fase 2 — Endpoints sin chequeo previo de recursos (validación primero)

- [ ] **T05 · `auth`: register y login** — RF-4, RF-9, RF-14
  Esquemas en `schemas/auth.js` con test primero; reemplazan los `if (!x) missing_fields` de `routes/auth.js`.
  **Hecho cuando:** `name: 123`, `email: {}`, `password: ["a"]` → 400 (no 500); T01 en verde; el `email` sigue normalizándose y `email_taken` detecta duplicados con mayúsculas.

- [ ] **T06 · `public`: bookings, activar cuenta, reprogramar** — RF-4, RF-9, RF-11, RF-14
  Esquemas en `schemas/public.js`; `scheduled_at` solo se exige como string (el código `invalid_scheduled_at` sigue en `appointmentScheduling`, D-P3); regla cruzada `client_required`; `reschedule` valida después de `publicAuth`.
  **Hecho cuando:** `scheduled_at: []` y `client: "x"` → 400; el test de T02 pasa para este endpoint; T01 en verde.

- [ ] **T07 · `appointments`: crear desde el panel y bloquear** — RF-4, RF-9, RF-11, RF-14
  Esquemas en `schemas/appointments.js`; en `createAppointmentFromPanel` la llamada ocupa el lugar de los `if` de RF-4/RF-15; en `POST /block` reemplaza el `Number.isNaN` de la ruta (`invalid_date`).
  **Hecho cuando:** el test de T02 pasa para `POST /appointments`; `missing_fields` e `invalid_date` conservan su orden; T01 en verde.

- [ ] **T08 · `services`: crear y precio** — RF-4, RF-9, RF-14
  Esquemas en `schemas/services.js`: `duration_minutes` entero > 0, `price` decimal ≥ 0. `PATCH /:id/prices` valida **antes** del 404 (orden actual).
  **Hecho cuando:** `price: "abc"` y `duration_minutes: 1.5` → 400; `price: 0` sigue siendo válido; T01 en verde.

- [ ] **T09 · `clients`: crear** — RF-4, RF-9, RF-14
  Esquema en `schemas/clients.js` con regla cruzada email-o-teléfono (orden: `missing_fields` → `email_or_phone_required` → `invalid_phone_format`). Retira `validatePhone` de `domain/client.js` cuando deje de usarse.
  **Hecho cuando:** `notes: 5` → 400; los tres códigos conservan su orden; T01 en verde.

- [ ] **T10 · `accounts`: comisiones** — RF-4, RF-14
  Esquema en `schemas/accounts.js` con `commissionRate(400)`; `PATCH /users/:id/commission` valida antes del 404 (orden actual). Elimina `validateRate` de la ruta.
  **Hecho cuando:** `commission_rate: "0.1"` y `1.5` → 400 `invalid_commission_rate`; `null` sigue válido; T01 en verde.

## Fase 3 — Endpoints con recurso previo (validación tras el 404)

- [ ] **T11 · `services` y `clients`: edición** — RF-6, RF-9, RF-14
  Esquemas de `PATCH /services/:id` y `PATCH /clients/:id`; `parseInput` **después** del 404 de la ruta.
  **Hecho cuando:** body inválido sobre un recurso ajeno → 404, no 400; sobre uno propio → 400; T01 en verde.

- [ ] **T12 · `appointments`: edición estricta** — RF-4, RF-11, RF-14
  Esquema `strictObject` en `schemas/appointments.js` con regla "al menos un campo" (`invalid_field`, `empty_update`); `editAppointment` lo usa en lugar de `assertEditablePayload`. Retira `domain/appointmentEdit.js` si queda vacío.
  **Hecho cuando:** campo desconocido → `invalid_field`; `notes: null` válido, `service_id: null` → `invalid_field`; `{}` → `empty_update`; T01 y los tests de `editAppointment` en verde.

## Fase 4 — Staff, perfil y disponibilidad

- [ ] **T13 · `staff`: invitar y editar** — RF-4, RF-11, RF-14
  Esquemas en `schemas/staff.js`: `POST /staff` (`commissionRate(422)`, tras el 403 de staff), `PATCH /staff/:id` y `PATCH /me` estrictos. Sustituyen `assertOwnerEditablePayload`, `assertSelfEditablePayload` y `assertValidCommissionRate`.
  **Hecho cuando:** `invalid_field`, `empty_update` e `invalid_commission_rate` (422) conservan estado y orden; `password` no se recorta; los tests de `inviteStaff`, `editStaff` y `editOwnProfile` en verde.

- [ ] **T14 · `staff`: horario semanal** — RF-5, RF-6
  Esquema de ventanas en `schemas/staff.js` (forma → 400 y valores → 422 con `rule(code, status)`); `replaceStaffAvailability` llama a `parseInput` **después** de alcance y estado. El solapamiento y `start < end` siguen en `availabilityWindows` si no pueden expresarse sin cambiar el orden.
  **Hecho cuando:** todos los casos de `tests/domain/availabilityWindows.test.js` y `tests/application/replaceStaffAvailability.test.js` siguen pasando; trabajador ajeno + body inválido → 404; `inactivo` + body inválido → 422.

## Fase 5 — Queries

- [ ] **T15 · `appointments` y `payments`: listados** — RF-4, RF-14
  Esquemas de query (solo tipos string) en `schemas/appointments.js` y `schemas/payments.js`; `listAppointments` conserva `invalid_date` (RF-39). `paymentsPeriod` **no** se toca.
  **Hecho cuando:** `date_from=abc` → 400 `invalid_date`; `period=xxx` → 400 `invalid_period`; `period` + `date_from` → `ambiguous_period_filter`; T01 en verde.

- [ ] **T16 · `availability`: slots** — RF-4, RF-9, D-P6
  Esquema en `schemas/availability.js`; conserva el código `date_from, date_to, service_id required`; fecha ilegible pasa de `200 []` a 400 `invalid_date`.
  **Hecho cuando:** el caso de T01 sobre fecha ilegible se actualiza explícitamente a 400 (único cambio permitido en la tabla) y el resto sigue en verde.

## Fase 6 — Cierre

- [ ] **T17 · Barrido de validaciones manuales** — RF-15
  Buscar `missing_fields`, `typeof` y `Number.isNaN` en `routes/`, `application/` y `domain/`.
  **Hecho cuando:** solo quedan las excepciones de la sección 3 del plan (`paymentsPeriod`, `appointmentScheduling`, reglas con datos o estado); ninguna regla de forma está duplicada.

- [ ] **T18 · Test de huecos completo** — RF-9, RF-10
  Completar `tests/integration/inputHardening.test.js`: body `null`/`[]`/ausente en cada `POST`/`PATCH`, tipos incorrectos de los campos listados en RF-9.
  **Hecho cuando:** ninguna entrada produce 500; todas responden 4xx con `{ error: <código> }`.

- [ ] **T19 · Documentación** — principio 10
  Sumar a `docs/diseno-gestor-turnos.md` una sección de validación (esquemas, `parseInput`, orden de invocación, excepciones) y una línea en el README (decisión técnica).
  **Hecho cuando:** `tests/docs/readme.test.js` en verde y la sección enlaza a la spec 007.

- [ ] **T20 · Gate final y demo** — criterios de finalización
  `npm test` y `npm run db:migrate` sobre DB vacía; recorrido `curl` de la spec: `POST /auth/register` con `{"name":123}` → 400; con el body completo → 201; `PUT /staff/<otro>/availability` con basura → 404.
  **Hecho cuando:** todo en verde y la demo manual reproduce los tres resultados.
