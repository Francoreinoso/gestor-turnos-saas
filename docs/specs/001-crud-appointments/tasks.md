# Tasks 001 — CRUD de appointments (panel autenticado)

Deriva de `plan.md`. Tareas de <30 min, en orden de dependencia. Cada una con
sus RF y una condición verificable. TDD: donde dice "test que falla", ese test
se escribe y se ve fallar antes de implementar.

## Fase 0 — Setup y migración

- [x] **T00 · Rama + migración `0003`** — RF-12
  Crear rama `spec/001-crud-appointments`. Añadir `check('services_duration_positive', sql\`duration_minutes > 0\`)` en `db/schema.js`, escribir a mano `db/migrations/0003_spec_001_service_duration.sql` con el `ALTER TABLE ... ADD CONSTRAINT`, y sumar la entrada en `meta/_journal.json`.
  **Hecho cuando:** `npm run db:migrate` sobre una DB vacía aplica `0000`..`0003` sin error y `\d services` en psql muestra el constraint.

## Fase 1 — Dominio (puro, sin dependencias)

- [x] **T01 · `bloqueado → cancelado` en la máquina de estados** — RF-23, RF-46
  Ampliar `tests/domain/appointment.test.js` con casos que fallan (`bloqueado→cancelado` válido; `completado→agendado` inválido). Añadir `bloqueado: ['cancelado']` a `VALID_TRANSITIONS` en `domain/appointment.js`.
  **Hecho cuando:** `node --test tests/domain/appointment.test.js` pasa; `canTransition('bloqueado','cancelado') === true` y `canTransition('completado','agendado') === false`.

- [x] **T02 · `domain/appointmentScheduling.js`** — RF-2, RF-9, RF-12, glosario
  Test que falla en `tests/domain/appointmentScheduling.test.js`, luego implementar `computeEndsAt` (lanza 422 si duración ≤ 0), `resolveInitialStatus` (fin ≤ now → `completado`), `overlaps` (`[inicio, fin)`, adyacentes no solapan).
  **Hecho cuando:** el test pasa cubriendo: suma de fin, duración 0 y negativa → error con `status: 422`, fin pasado/igual/futuro, y franjas adyacentes → `false`.

- [x] **T03 · `domain/appointmentEdit.js`** — RF-20, RF-21, RF-22
  Test que falla en `tests/domain/appointmentEdit.test.js`, luego `assertEditablePayload(body)`: 400 si hay campo prohibido (`status`, `scheduled_at`, …), 400 si no queda ningún editable, OK con sólo `notes: null`.
  **Hecho cuando:** el test pasa los tres casos y devuelve los campos editables saneados.

## Fase 2 — Repositorios

- [x] **T04 · `appointmentRepo.findForList` + `findVisible`** — RF-34, RF-36..RF-41, RF-43
  Añadir a `repositories/appointments.js`: `findForList(db, { accountId, filters, limit })` (filtros de estado/rango/profesional, orden `scheduled_at` asc, `LIMIT`) y `findVisible(db, { id, accountId })` con relaciones cliente/servicio/profesional.
  **Hecho cuando:** un test de integración corto inserta 3 turnos y `findForList` los devuelve ordenados y respeta `limit: 2`; `findVisible` de otra cuenta devuelve `undefined`.

## Fase 3 — Casos de uso (repos fake, test primero; patrón de `tests/application/createAppointment.test.js`)

- [x] **T05 · `createAppointmentFromPanel` — rama `agendado`** — RF-1, RF-2, RF-3, RF-4, RF-11, RF-15, RF-17
  Test que falla, luego el flujo feliz: valida payload, resuelve servicio activo y cliente (`client_id` o `findOrCreate`), crea turno `agendado` y llama `tokens.create`; respuesta con `access_token`.
  **Hecho cuando:** el test verifica creación con `status: 'agendado'`, `scheduled_until` = inicio + duración, y que se llamó `tokens.create` una vez.

- [x] **T06 · `createAppointmentFromPanel` — rama `completado` + pago atómico** — RF-9, RF-18
  Test que falla: fin ≤ now → `db.transaction` con `createPayment`, sin `tokens.create`; si `createPayment` lanza, no se crea el turno.
  **Hecho cuando:** el test verifica `status: 'completado'`, `createPayment` llamado, `tokens.create` no llamado, y que un `createPayment` que lanza propaga el error sin dejar turno.

- [x] **T07 · `createAppointmentFromPanel` — profesional y rol** — RF-5, RF-6, RF-7, RF-13, RF-14, RF-16
  Test que falla, luego: `staff` fuerza su propio id (precede a un profesional recibido); profesional explícito válido no valida disponibilidad; sin profesional usa `findAvailableProfessional` y da 409 si no hay; `client_id`/profesional de otra cuenta → 404.
  **Hecho cuando:** el test cubre los 6 RF; en el caso staff, `assigned_user_id` del turno creado es el del staff.

- [x] **T08 · `createAppointmentFromPanel` — mapa de error de solapamiento** — RF-10
  Test que falla: cuando `appointments.create` lanza `appointment_overlap` (o `err.cause.message`), el use case lanza error con `status: 409`.
  **Hecho cuando:** el test simula el error del trigger y espera `status: 409`.

- [x] **T09 · `editAppointment` — política de campos + guardas** — RF-19, RF-21, RF-22, RF-23, RF-34
  Test que falla, luego: `assertEditablePayload` → 400; turno de otra cuenta o (staff) ajeno → 404; `status !== 'agendado'` → 422.
  **Hecho cuando:** el test cubre 400 / 404 / 422 y el caso feliz devuelve el turno actualizado.

- [x] **T10 · `editAppointment` — referencias, servicio y solapamiento** — RF-24, RF-25, RF-26, RF-27, RF-28, RF-29, RF-33
  Test que falla, luego: validar servicio/cliente/profesional nuevos → 404; cambio de servicio recalcula fin con **mismo** `scheduled_at`; pre-check de solapamiento del estado final → 409; `staff` que reasigna a otro → 403.
  **Hecho cuando:** el test verifica el recálculo de fin, el 409 por choque tras cambiar servicio o profesional, y el 403 del staff.

- [x] **T11 · `cancelBlock`** — RF-32, RF-46, RF-47, RF-48
  Test que falla, luego: inexistente / (staff) bloqueo de negocio o ajeno → 404; existe pero no `bloqueado` o ya `cancelado` → 422; OK → `update(status: 'cancelado')`, nunca `delete`.
  **Hecho cuando:** el test cubre 404 / 422 / éxito y afirma que `appointments.delete` no se llamó.

- [x] **T12 · `cancelAppointment` — guarda `agendado`** — RF-44, RF-45
  Test que falla: `status !== 'agendado'` (incl. `bloqueado`) → 422. Añadir la guarda explícita antes de `assertTransition`.
  **Hecho cuando:** el test verifica 422 para `bloqueado` y `completado`, y 200 para `agendado`.

- [x] **T13 · `listAppointments`** — RF-36, RF-37, RF-38, RF-39, RF-40, RF-41, RF-42
  Test que falla, luego: valida `date_from`/`date_to` ISO → 400; `staff` fuerza profesional propio; filtros `status`/`type`, rango sobre `scheduled_at`; `limit: 500`; rango invertido o sin match → `[]`.
  **Hecho cuando:** el test cubre 400 por fecha inválida, `[]` por rango invertido, `limit=500` pasado al repo, y el override de profesional para staff.

- [x] **T14 · `getAppointment`** — RF-34, RF-43
  Test que falla, luego: turno por id acotado a la cuenta; `staff` sólo si es suyo → 404; proyección resumida igual que el listado.
  **Hecho cuando:** el test verifica 404 para cross-tenant y para staff ajeno, y el shape de la respuesta.

## Fase 4 — Rutas HTTP

- [x] **T15 · Mover el booking público a `POST /public/bookings`** — (D-P2; no cambia RF)
  Trasladar el handler actual de `POST /appointments/` a `routes/public.js` como `POST /public/bookings`, bajo el `rateLimit` del grupo, sin `publicAuth`. Quitar la ruta vieja de `routes/appointments.js`.
  **Hecho cuando:** `curl -X POST /public/bookings` crea un turno y devuelve `access_token`; `POST /appointments` sin token responde 401.

- [x] **T16 · `POST /appointments` autenticado** — RF-1..RF-18
  Nueva ruta con `auth` que delega en `createAppointmentFromPanel`; 201 con turno (+ `access_token` si nace `agendado`). Mapear `status` del error a la respuesta HTTP.
  **Hecho cuando:** `curl` con JWT crea un turno futuro (201 + `access_token`) y uno con fin pasado (201, `status: 'completado'`, sin `access_token`).

- [x] **T17 · `PATCH /appointments/:id`** — RF-19..RF-29, RF-33
  Nueva ruta con `auth` que delega en `editAppointment`; 200 con el turno actualizado.
  **Hecho cuando:** `curl` edita `notes` de un turno `agendado` (200); enviar `status` en el body responde 400.

- [x] **T18 · `GET /appointments` y `GET /appointments/:id`** — RF-34, RF-36..RF-43
  Reemplazar la lógica inline por delegación en `listAppointments` / `getAppointment`.
  **Hecho cuando:** el listado responde ordenado y filtrado; `GET /:id` de otra cuenta responde 404; `npm test` de integración existente sigue verde.

- [x] **T19 · `PATCH /:id/cancel` y `PATCH /:id/cancel-block`** — RF-44..RF-48
  `/cancel` usa `cancelAppointment` con la guarda `agendado`. `/cancel-block` pasa a delegar en `cancelBlock` y responde **200** (antes 204).
  **Hecho cuando:** `curl` cancela un turno `agendado` (200); `cancel-block` sobre un bloqueo deja la fila con `status='cancelado'` (verificable en psql) y responde 200; repetir → 422.

## Fase 5 — Tests de integración (Postgres real, `withAccount`, trigger activo)

- [x] **T20 · Integración: crear desde el panel** — RF-7, RF-9, RF-10, RF-16
  Fin pasado → fila `completado` + fila en `payments`; `createPayment` forzado a fallar → sin fila de turno. Staff pasa otro profesional → turno a su nombre. Autoasignación sin disponibilidad → 409. Bloqueo de negocio activo → 409.
  **Hecho cuando:** los 4 escenarios pasan en `tests/integration/`.

- [x] **T21 · Integración: editar** — RF-20, RF-22, RF-25, RF-29
  Editar servicio a uno más largo que pisa el turno siguiente → 409, fila intacta. Reasignar a profesional con conflicto → 409. `status` en el body → 400. `notes: null` → limpia. Turnos adyacentes (fin == inicio) → ambos 201.
  **Hecho cuando:** los 5 escenarios pasan.

- [x] **T22 · Integración: alcance por rol** — RF-34, RF-35
  Turno de otra cuenta en get/edit/cancel → 404 (no 403). Staff sobre turno de otro profesional → 404.
  **Hecho cuando:** ambos escenarios pasan y ninguna respuesta es 403.

- [x] **T23 · Integración: cancelar bloqueo** — RF-46, RF-47, RF-48
  `cancel-block` → fila presente con `status='cancelado'`; repetir → 422; staff sobre bloqueo de negocio → 404. Verificar que el trigger deja crear un turno en esa franja tras cancelar el bloqueo.
  **Hecho cuando:** los 4 escenarios pasan.

- [x] **T24 · Integración: listado** — RF-39, RF-40, RF-41, RF-42
  501 turnos → respuesta de 500; rango invertido → `[]`; fecha inválida → 400; staff ve sólo los suyos.
  **Hecho cuando:** los 4 escenarios pasan.

- [x] **T25 · Integración: constraint de duración** — RF-12
  Insertar un `service` con `duration_minutes = 0` → viola `services_duration_positive`; crear turno con ese servicio (vía API) → 422 antes de tocar la DB.
  **Hecho cuando:** el test verifica el rechazo de la DB y el 422 de la API.

## Fase 6 — Documentación y cierre

- [x] **T26 · Actualizar `CLAUDE.md`** — (D-P5; RF-46)
  Máquina de estados: añadir `bloqueado → cancelado`; nota de que `cancel-block` es baja lógica, no `DELETE`.
  **Hecho cuando:** `CLAUDE.md` refleja la transición y no contradice `spec.md`.

- [x] **T27 · Gate final** — todos los RF
  `npm test` completo y `npm run db:migrate` sobre DB vacía, ambos verdes. Recorrido manual con `curl` del flujo de "Criterios de finalización" de `spec.md`.
  **Hecho cuando:** ambos comandos salen con código 0 y el recorrido manual reproduce cada paso (201 pago / 201 futuro / edición de servicio / 409 / 422 / 404 / cancel-block).

---

## Estado: implementado (92/92 tests en verde)

Dos hallazgos durante la implementación, no previstos en el plan:

- **Migración `0004_spec_001_block_cancel_nullability.sql`** — la decisión T4 (baja
  lógica del bloqueo) violaba el CHECK `appointments_nullable_fields_check` de la
  migración 0001: un bloqueo cancelado queda con `client_id`/`service_id` NULL y
  `status != 'bloqueado'`. El CHECK se relajó para no exigir referencias en filas
  `cancelado`, manteniendo la exigencia para bloqueos activos y turnos no terminales.
- **`POST /appointments/block`** pasaba `scheduled_at`/`scheduled_until` como strings
  al repo → 500 (`value.toISOString is not a function`). Bug latente preexistente;
  se corrigió con la misma coerción `new Date()` + validación ISO que usa el resto.

### Cobertura completada (auditoría RF-por-RF)

Se agregaron 10 tests para los RF que quedaban solo en código:
RF-3, RF-4, RF-6 (positivo), RF-14, RF-15, RF-27, RF-30, RF-36, RF-37 (AND), RF-38.
Total: **102/102 en verde**. Los 48 RF tienen al menos un test directo.
