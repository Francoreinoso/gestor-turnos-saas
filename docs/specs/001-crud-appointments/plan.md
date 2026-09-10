# Plan 001 — CRUD de appointments (panel autenticado)

Deriva de `spec.md` (48 RF). Sin código: módulos, modelo de datos, decisiones
y estrategia de tests. Cada parte indica los RF que cubre.

## 1. Módulos

### `domain/` (puro, sin I/O)

- **`domain/appointment.js`** (modificar) — añadir `bloqueado: ['cancelado']` a `VALID_TRANSITIONS`; firmas intactas. → RF-23, RF-46
- **`domain/appointmentScheduling.js`** (nuevo) — reglas de tiempo/estado, puras:
  - `computeEndsAt(startsAt, durationMinutes)` → `Date`; lanza 422 si `durationMinutes <= 0`. → RF-2, RF-12
  - `resolveInitialStatus(endsAt, now)` → `'completado'` si `endsAt <= now`, si no `'agendado'`. → RF-1, RF-9
  - `overlaps(aStart, aEnd, bStart, bEnd)` → `boolean`, intervalos `[inicio, fin)` (adyacentes no solapan). → glosario, pre-checks RF-10/RF-29
- **`domain/appointmentEdit.js`** (nuevo) — política de edición, pura:
  - `EDITABLE_FIELDS` = notas, servicio, profesional, cliente.
  - `assertEditablePayload(body)` — lanza 400 si hay campos prohibidos (RF-22) o si no queda ningún editable (RF-21); semántica de `null` (RF-20: `notes` acepta `null`/`''`, el resto no).
- `domain/client.js`, `domain/token.js` — sin cambios (se reusan `normalizeEmail`, `generateAccessToken`).

### `application/` (orquesta; recibe `db` y `repos`)

- **`application/createAppointmentFromPanel.js`** (nuevo) — RF-1..RF-18
  1. Validar payload mínimo (`client_id` o datos de cliente, `service_id`, `scheduled_at` ISO) → 400 (RF-4, RF-15).
  2. `serviceRepo.findActive` → 404 (RF-11); `computeEndsAt` → 422 si duración ≤ 0 (RF-12).
  3. Cliente: `client_id` validado contra la cuenta (RF-13) o `clientRepo.findOrCreate` con email/teléfono normalizados (RF-3).
  4. Profesional: rol `staff` fuerza `req.user.id` e ignora lo recibido (RF-16, precede a RF-5); explícito → validar cuenta/estado del usuario (RF-14), sin validar disponibilidad (RF-5); ausente → `findAvailableProfessional` (reuso) → 409 si no hay (RF-7), respeta disponibilidad (RF-6).
  5. `resolveInitialStatus`: `agendado` → crear turno + `tokenRepo.create`, respuesta con enlace (RF-17); `completado` → `db.transaction` { crear turno + `createPayment` }, sin token (RF-9, RF-18); rollback total si falla el pago (principio 4).
  6. Error `appointment_overlap` del trigger → 409 (RF-10), mismo patrón que `createAppointment.js`.
  - Reusa: `findAvailableProfessional.js`, `createPayment.js`, `clientRepo.findOrCreate`, `serviceRepo.findActive`, `generateAccessToken`, `normalizeEmail`.
- **`application/editAppointment.js`** (nuevo) — RF-19..RF-29, RF-33
  1. `assertEditablePayload` → 400 (RF-21, RF-22).
  2. Cargar turno acotado a la cuenta + visibilidad por rol → 404 (RF-34).
  3. `staff` que reasigna a otro profesional → 403 (RF-33).
  4. `status !== 'agendado'` → 422 (RF-23).
  5. Validar referencias nuevas: servicio (RF-26), cliente (RF-27), profesional (RF-28) → 404.
  6. Estado final: si cambia el servicio, `computeEndsAt` con nueva duración y **mismo** `scheduled_at` (RF-24, RF-25).
  7. Pre-check de solapamiento del estado final (`findUserConflict` + `findBusinessBlock`) → 409 (RF-29); `update` en try/catch por si el trigger dispara igual (concurrencia).
- **`application/cancelBlock.js`** (nuevo) — RF-32, RF-46..RF-48
  - Inexistente o fuera de alcance → 404; existe pero no es `bloqueado` / ya `cancelado` → 422 (RF-47).
  - `staff`: sólo bloqueos con `assigned_user_id === req.user.id`; bloqueo de negocio (`NULL`) o ajeno → 404 (RF-32, RF-48).
  - `update(status:'cancelado')`, nunca `DELETE` (RF-46, principio 5).
- **`application/cancelAppointment.js`** (modificar) — RF-44, RF-45
  - Con `bloqueado→cancelado` ahora válido en la máquina, añadir guarda explícita: `status !== 'agendado'` → 422 (RF-45). La baja de bloqueos va por `cancelBlock.js`.
- **`application/listAppointments.js`** (nuevo, extrae lógica de la ruta) — RF-36..RF-42
  - Validar `date_from`/`date_to` ISO → 400 (RF-39); `staff` fuerza `assigned_user_id = req.user.id` (RF-42); filtros `status` o alias `type`, rango sobre `scheduled_at` (RF-38), profesional; orden asc + `LIMIT 500` (RF-41); rango invertido o sin match → `[]` (RF-40); proyección resumida (RF-36).
- **`application/getAppointment.js`** (nuevo, extrae lógica de la ruta) — RF-34, RF-43
  - Turno por id acotado a la cuenta; `staff` sólo si es suyo → 404 (RF-34); misma proyección que el listado (RF-43).

### `infrastructure/http`

- **`routes/appointments.js`** (modificar)
  - `POST /` → **añadir `auth`**; delega en `createAppointmentFromPanel`; 201 con turno (+ `access_token` si nace `agendado`). — RF-1..RF-18
  - `PATCH /:id` (nuevo) → `auth`; delega en `editAppointment`; 200. Campos whitelisteados, sin `status` → cumple principio 7. — RF-19..RF-29, RF-33
  - `GET /` y `GET /:id` → `auth`; delegan en `listAppointments` / `getAppointment`. — RF-36..RF-43
  - `PATCH /:id/cancel` → sin cambio de contrato; `cancelAppointment` con guarda `agendado`. — RF-44, RF-45
  - `PATCH /:id/cancel-block` → **reescribir**: delega en `cancelBlock`; 200 (era 204). — RF-46..RF-48
  - `POST /block`, `PATCH /:id/correct` → sin cambios.
- **`routes/public.js`** (modificar) — nueva `POST /public/bookings` con el handler actual de `POST /appointments/` (crea turno público, autoasigna, genera token). Bajo el `rateLimit` del grupo `/public/*`, sin `publicAuth` (el cliente aún no tiene token). El handler se mueve tal cual; `createAppointment.js` no se toca.
- **`app.js`** — sin cambios (routers ya montados).
- **`ownerOnly`** — **no se crea**: ningún RF de esta spec define una acción exclusiva de owner; el alcance por rol se resuelve dentro de los use cases (necesitan el turno cargado para elegir 404 vs 403). — D-P3.

### `infrastructure/db`

- **`repositories/appointments.js`** (modificar)
  - `findForList(db, { accountId, filters, limit })` — encapsula el `findMany` con filtros + `LIMIT` + proyección que hoy vive en la ruta. — RF-36..RF-41
  - `findVisible(db, { id, accountId })` con relaciones — para get/edit/cancel. — RF-34, RF-43
  - Se reusan `findUserConflict`, `findBusinessBlock` para los pre-checks; `delete` queda sin llamadas nuevas.
- **`repositories/users.js`** — agregar `findActiveById` sólo si `findById` no alcanza para validar profesional (RF-14, RF-28); si alcanza, no se agrega (YAGNI).

### `docs`

- **`CLAUDE.md`** — máquina de estados: añadir `bloqueado → cancelado`; nota de que `cancel-block` es baja lógica, no `DELETE`.

## 2. Modelo de datos

Sin cambios de columnas. `cancelado` ya está en `appointmentStatusEnum`. El trigger `check_appointment_overlap` (migración 0001) ya excluye `status = 'cancelado'`: un bloqueo cancelado deja de bloquear sin tocar el trigger. El CHECK de nulabilidad admite un `completado` creado directo (exige `client_id`/`service_id`/`assigned_user_id`, que el panel siempre aporta).

**Migración `0003_spec_001_service_duration.sql`** (hand-written, principio 8):

```sql
ALTER TABLE "services"
  ADD CONSTRAINT "services_duration_positive" CHECK (duration_minutes > 0);
```

- Respalda RF-12 en la DB (principio 2). Se añade `.check()` en `db/schema.js` para que el snapshot de Drizzle quede consistente + entrada en `_journal.json`.
- La misma regla se valida en `domain/appointmentScheduling.js` para devolver 422 con mensaje claro antes de tocar la DB.

**No** se agrega trigger de transiciones: RF-23 y `bloqueado→cancelado` son reglas de dominio (la máquina de estados), coherente con que el cron ya hace updates de estado sin trigger. Registrado en `spec.md` → "Notas de arquitectura".

## 3. Decisiones (con alternativa descartada)

- **D-P1. Use case nuevo `createAppointmentFromPanel`, no parametrizar `createAppointment`.** El panel diverge del booking en 4 puntos (fecha pasada, profesional sin validar disponibilidad, nacimiento en `completado` + pago, sin token). *Descartado:* banderas `{ authenticated, allowPast }` sobre `createAppointment` → función con muchas ramas, difícil de testear, dos razones para cambiar (principio 3). Se comparten helpers puros y `findAvailableProfessional`/`createPayment`.
- **D-P2. Mover el booking público a `POST /public/bookings`.** *Descartado:* (a) `POST /appointments/panel` — sustantivo no REST; (b) un handler que ramifica según haya JWT — mezcla dos mecanismos de auth en una ruta (principio 7, "rutas separadas cuando el auth difiere"). Beneficio lateral: el booking pasa a estar rate-limitado por el grupo `/public/*`.
- **D-P3. El alcance por rol se decide en el use case, no en middleware.** Distinguir 404 (fuera de alcance) de 403 (acción vedada) exige tener el turno cargado. *Descartado:* middleware `staffScope` — no tiene el recurso a mano, llevaría a doble query o a filtrar en dos lugares.
- **D-P4. Pre-chequeo de solapamiento en la app + trigger como red final.** Da un 409 con mensaje claro sin depender del texto de la excepción del trigger y cubre la carrera con el `catch`. *Descartado:* confiar sólo en el trigger — obliga a parsear `err.cause.message` siempre y no permite evaluar el "estado final combinado" (RF-29) con precisión.
- **D-P5. `cancel-block` pasa a `UPDATE status='cancelado'`.** Cumple el principio 5 sin enmendar la constitución. *Descartado:* mantener el `DELETE` físico como excepción documentada (opción intermedia del triage) — el usuario eligió coherencia total; el trigger ya trata `cancelado` como no-bloqueante, así que no hay costo funcional.
- **D-P6. Duración positiva: CHECK en DB + validación en dominio.** El CHECK es la invariante (principio 2); el dominio da el 422 legible (RF-12). *Descartado:* sólo validación de app — una fila con `duration_minutes <= 0` insertada por otra vía rompería `computeEndsAt` en silencio.
- **D-P7. Extraer `listAppointments`/`getAppointment` a use cases.** Con el tope de 500, la validación ISO y el scoping por rol, la lógica dejó de ser trivial y necesita test unitario (principio 9). *Descartado:* dejarlo en la ruta — no testeable sin levantar HTTP.

## 4. Estrategia de tests (TDD, principio 9)

Orden: primero los tests que fallan de los casos **no obvios**; después los happy-path de CRUD.

### Unit — `tests/domain/` (sin DB, `node:test`)
- `appointment.test.js` (ampliar): `bloqueado→cancelado` válido; `agendado→cancelado` válido; `completado→agendado` inválido (422). — RF-23, RF-46
- `appointmentScheduling.test.js` (nuevo): `computeEndsAt` suma correcta; duración 0/negativa → 422; `resolveInitialStatus` con fin pasado/igual/futuro; `overlaps` con franjas adyacentes → `false`. — RF-2, RF-9, RF-12, glosario
- `appointmentEdit.test.js` (nuevo): payload vacío → 400; con `status`/`scheduled_at` → 400; sólo `notes:null` → OK. — RF-20, RF-21, RF-22

### Application — `tests/application/` (repos fake, `db={}`; patrón de `createAppointment.test.js`)
- `createAppointmentFromPanel.test.js`: staff fuerza profesional propio (RF-16); profesional explícito no valida disponibilidad (RF-5); sin profesional y `findAvailableProfessional` vacío → 409 (RF-7); fin futuro → llama `tokens.create` (RF-17); fin pasado → llama `createPayment` y **no** `tokens.create` (RF-9, RF-18); `client_id` de otra cuenta → 404 (RF-13).
- `editAppointment.test.js`: turno no `agendado` → 422 (RF-23); staff reasignando a otro → 403 (RF-33); cambio de servicio recalcula fin con mismo inicio (RF-24, RF-25); referencia inexistente → 404 (RF-26..28).
- `listAppointments.test.js`: `date_from` inválida → 400 (RF-39); staff ignora `employee_id` recibido (RF-42); `date_from > date_to` → `[]` (RF-40); se pasa `limit=500` al repo (RF-41).
- `cancelBlock.test.js`: no-bloqueo → 422; ya `cancelado` → 422; staff sobre bloqueo de negocio → 404; ok → `update(status:'cancelado')`, nunca `delete` (RF-46..48).

### Integración — `tests/integration/` (Postgres real, `withAccount`, trigger activo)
1. Panel create con fin pasado → fila `completado` + fila en `payments`; si `createPayment` falla (repo stub que tira) → sin fila de turno (rollback). — RF-9, principio 4
2. Editar servicio a uno más largo que pisa el turno siguiente → 409, fila intacta. — RF-25, RF-29
3. Reasignar profesional a uno con conflicto → 409. — RF-29
4. `staff` crea pasando otro profesional → `assigned_user_id === staff.id`. — RF-16
5. Autoasignación sin disponibilidad → 409; bloqueo de negocio activo impide crear y editar. — RF-7, RF-10, RF-29
6. `PATCH /:id` con `status` en el body → 400; con `notes:null` → limpia. — RF-20, RF-22
7. Turno de otra cuenta → 404 (no 403); `staff` sobre turno de otro profesional → 404. — RF-34, RF-35
8. Dos turnos adyacentes (fin == inicio) → ambos 201. — glosario/trigger
9. `cancel-block` → fila con `status='cancelado'` presente (no borrada); repetir → 422; `staff` sobre bloqueo de negocio → 404. — RF-46..48
10. Listado: 501 turnos → respuesta de 500 (RF-41); rango invertido → `[]` (RF-40); fecha inválida → 400 (RF-39); `staff` ve sólo los suyos (RF-42).
11. Migración: `npm run db:migrate` sobre DB vacía aplica `0003`; servicio con `duration_minutes = 0` → viola `services_duration_positive`. — RF-12

### Gate
`npm test` (unit + app + integración) y `npm run db:migrate` en verde sobre DB vacía antes de cada commit (principio 9).

## 5. Mapa RF → módulo

| RF | Dónde se cubre |
|---|---|
| RF-1, RF-2 | `createAppointmentFromPanel` + `computeEndsAt` |
| RF-3 | `clientRepo.findOrCreate` (reuso) |
| RF-4, RF-15 | validación de payload en `createAppointmentFromPanel` / ruta |
| RF-5, RF-6, RF-7 | `createAppointmentFromPanel` + `findAvailableProfessional` (reuso) |
| RF-8 | `createAppointmentFromPanel` (sin cota inferior; nada que validar) |
| RF-9, RF-18 | `resolveInitialStatus` + `db.transaction` con `createPayment` |
| RF-10 | pre-check `findUserConflict`/`findBusinessBlock` + trigger |
| RF-11, RF-12 | `serviceRepo.findActive` + `computeEndsAt` + CHECK `0003` |
| RF-13, RF-14 | validación de referencias en `createAppointmentFromPanel` |
| RF-16 | `createAppointmentFromPanel` (rama rol staff) |
| RF-17 | `tokenRepo.create` + `generateAccessToken` (reuso) |
| RF-19..RF-22 | `domain/appointmentEdit.js` + `editAppointment` |
| RF-23 | `domain/appointment.js` (máquina de estados) vía `editAppointment` |
| RF-24, RF-25 | `editAppointment` + `computeEndsAt` |
| RF-26, RF-27, RF-28 | `editAppointment` (validación de referencias) |
| RF-29 | `editAppointment` pre-check + trigger |
| RF-30, RF-31, RF-35 | lógica de rol en `editAppointment` / `cancelBlock` / `getAppointment` |
| RF-32, RF-48 | `cancelBlock` (bloqueo de negocio / ajeno → 404) |
| RF-33 | `editAppointment` (staff reasigna → 403) |
| RF-34 | `getAppointment` + `appointmentRepo.findVisible` |
| RF-36, RF-37, RF-38 | `listAppointments` + `appointmentRepo.findForList` |
| RF-39, RF-40 | `listAppointments` (validación ISO / rango) |
| RF-41 | `appointmentRepo.findForList` (`LIMIT 500`) |
| RF-42 | `listAppointments` (rama rol staff) |
| RF-43 | `getAppointment` |
| RF-44, RF-45 | `cancelAppointment` (guarda `agendado`) + ruta `/cancel` |
| RF-46, RF-47 | `cancelBlock` + ruta `/cancel-block` |
| No funcionales (UTC/ISO, forma de error, concurrencia) | rutas + use cases; trigger como red final |

## 6. Verificación

- `npm run db:migrate` limpio sobre DB vacía (aplica `0000`..`0003`).
- `npm test` verde: unit + application + integración.
- Recorrido manual (curl) del flujo de "Criterios de finalización" de `spec.md`: crear con fin pasado y ver el pago → crear futuro con profesional fuera de horario → editar servicio y ver el nuevo fin → reasignar con choque (409) → editar tras `en_progreso` (422) → repetir como staff sobre turno ajeno (404) → `cancel-block` y confirmar fila con `status='cancelado'`.
- El booking público sigue operativo en `POST /public/bookings` con el rate-limit del grupo.

## 7. Archivos tocados (resumen)

- **Nuevos:** `domain/appointmentScheduling.js`, `domain/appointmentEdit.js`, `application/{createAppointmentFromPanel,editAppointment,cancelBlock,listAppointments,getAppointment}.js`, `db/migrations/0003_spec_001_service_duration.sql`, tests unit/app/integración nuevos.
- **Modificados:** `domain/appointment.js`, `application/cancelAppointment.js`, `infrastructure/http/routes/appointments.js`, `infrastructure/http/routes/public.js`, `infrastructure/db/repositories/appointments.js`, `db/schema.js`, `db/migrations/meta/_journal.json`, `CLAUDE.md`, `tests/domain/appointment.test.js`, `tests/integration/appointments.test.js`.
