# Plan 002 — Gestión de trabajadores (staff)

Deriva de `spec.md` (34 RF). Sin código: módulos, modelo de datos, decisiones
y estrategia de tests. Cada parte indica los RF que cubre.

## 1. Módulos

### `domain/` (puro, sin I/O)

- **`domain/userStatus.js`** (nuevo) — máquina de estados de un usuario, misma
  forma que `domain/appointment.js`:
  - `STATUSES = ['pendiente', 'activo', 'inactivo']`
  - `VALID_TRANSITIONS = { pendiente: ['activo', 'inactivo'], activo: ['inactivo'], inactivo: ['pendiente'] }`
  - `canTransition(from, to)`, `assertTransition(from, to)` (422 si inválida).
  → RF-7, RF-11, RF-17, RF-25, RF-28
- **`domain/staffInvite.js`** (nuevo) — decide qué rama del alta aplica, pura:
  - `decideInviteAction({ existingUser, accountId })` → `'create' | 'reject' | 'reactivate' | 'resend'`:
    sin `existingUser` → `create`; `status: 'activo'` (cualquier cuenta) →
    `reject`; `account_id` distinto (`pendiente` o `inactivo`) → `reject`;
    misma cuenta + `inactivo` → `reactivate`; misma cuenta + `pendiente` →
    `resend`.
  → RF-6, RF-7, RF-8
- **`domain/staffEdit.js`** (nuevo) — políticas de payload, puras (mismo
  patrón que `domain/appointmentEdit.js`):
  - `assertValidCommissionRate(rate)` — 422 si `rate` no es `null` y cae
    fuera de `[0, 1]`; `null` nunca es inválido. Reusada en alta y edición.
  - `OWNER_EDITABLE_FIELDS` = `name`, `email`, `commission_rate`;
    `assertOwnerEditablePayload(body)` — 400 si no queda ningún campo
    editable o si trae uno no permitido (`status`, `role`, etc.).
  - `SELF_EDITABLE_FIELDS` = `name`, `password`; `assertSelfEditablePayload(body)`
    — 400 si intenta tocar `email`, `role` o `commission_rate`.
  → RF-4, RF-16, RF-19, RF-20, RF-21, RF-23
- `domain/token.js` — sin cambios; `generateAccessToken` ya es genérico y se
  reusa para el token de invitación. → RF-1, RF-8, RF-9, RF-12, RF-18
- `domain/client.js` — sin cambios; se reusa `normalizeEmail` para comparar
  emails de forma case-insensitive en todo el flujo (NFR).

### `application/` (orquesta; recibe `db` y `repos`)

- **`application/inviteStaff.js`** (nuevo) — RF-1..RF-9, RF-13..RF-15
  1. `staff` que invoca → 403 (RF-14).
  2. Validar `name`/`email` presentes → 400 (RF-5).
  3. `assertValidCommissionRate` → 422 (RF-4).
  4. `userRepo.findByEmail(normalizeEmail(email))` → `decideInviteAction`
     (`domain/staffInvite.js`) resuelve la rama.
  5. `reject` → 409 (RF-6), sin tocar nada.
  6. `create` / `reactivate` / `resend`, todo dentro de un único
     `db.transaction`:
     - `create`: `userRepo.create` con `status: 'pendiente'`, `role: 'staff'` (RF-2, RF-3).
     - `reactivate` / `resend`: `userRepo.update` de la fila existente con
       los datos nuevos y `status: 'pendiente'` si venía `inactivo` (RF-7, RF-8).
     - `invitationTokenRepo.invalidateAllForUser` + `generateAccessToken` +
       `invitationTokenRepo.create` con `expires_at` a 72 h (RF-9).
     - `emailService.sendInvitation({ to, link })` **dentro** de la misma
       transacción — si tira, el rollback deja todo intacto (RF-15).
  7. Responder 201 (`create`) o 200 (`reactivate` / `resend`).
- **`application/resendStaffInvitation.js`** (nuevo) — RF-12, RF-13
  - Cargar trabajador acotado a cuenta (reusa `userRepo.findVisible`) → 404
    (RF-34); `status !== 'pendiente'` → 422 (RF-13); misma secuencia
    transaccional de invalidar + crear token + enviar que `inviteStaff`
    (RF-12, RF-15 aplica igual).
- **`application/editStaff.js`** (nuevo) — RF-16..RF-19, RF-22..RF-24
  1. `assertOwnerEditablePayload` → 400 (RF-23).
  2. Si viene `commission_rate`: `assertValidCommissionRate` → 422 (RF-4).
  3. Cargar trabajador acotado a cuenta; `staff` sobre otro → 404 (RF-24, RF-34).
  4. `status === 'inactivo'` → 422 (RF-17).
  5. Si cambia el email: `userRepo.findByEmail` → si pertenece a cualquier
     otro usuario existente (cualquier estado) → 409, **nunca** reactiva
     (RF-22).
  6. `update` con los campos recibidos; `commission_rate: null` limpia
     (RF-16, RF-19).
  7. Si `status === 'pendiente'` y cambió el email: reemitir invitación
     (invalidar + crear + enviar) dentro de la misma transacción que el
     `update` (RF-18).
- **`application/editOwnProfile.js`** (nuevo) — RF-20, RF-21
  1. `assertSelfEditablePayload` → 400 (RF-21).
  2. Si viene `password`: `bcrypt.hash` (mismo costo que `register`).
  3. `userRepo.update(db, req.user.id, {...})` — el actor edita su propia
     fila por el id del JWT, sin scoping adicional (RF-20).
- **`application/deactivateStaff.js`** (nuevo) — RF-25..RF-29
  1. `staff` que invoca (sobre sí mismo o sobre otro) → 403 (RF-29), antes
     de cargar el recurso.
  2. Cargar trabajador acotado a cuenta → 404 si es de otra cuenta (RF-34).
  3. `status === 'inactivo'` → 422 (RF-28).
  4. `assertTransition(status, 'inactivo')` (`domain/userStatus.js`).
  5. `db.transaction`: `userRepo.update(..., { status: 'inactivo' })` +
     `appointmentRepo.cancelFutureForUser(db, { userId, now })` — el bulk
     update solo toca `agendado` / `bloqueado` con `scheduled_at` futuro
     (RF-25, RF-26, RF-27).
- **`application/listStaff.js`** (nuevo) — RF-31..RF-33
  - `staff` → 403 (RF-33). `userRepo.findManyByAccount(db, accountId, { status })`,
    orden alfabético por nombre, proyección con estado y comisión (RF-31, RF-32).
- **`application/getStaff.js`** (nuevo) — RF-34
  - `userRepo.findVisible(db, { id, accountId })` → 404 si no existe o es
    de otra cuenta.
- **`application/activateStaffAccount.js`** (nuevo, público) — RF-10, RF-11
  1. `invitationTokenRepo.findValidByHash(hash)` (no vencido, `used_at IS NULL`)
     → 410 si no hay match (RF-10).
  2. `db.transaction`: `userRepo.update(userId, { password_hash, status: 'activo' })`
     + `invitationTokenRepo.markUsed(tokenId)` (RF-11).

### `infrastructure/http`

- **`routes/staff.js`** (nuevo)
  - `POST /staff` → `auth`; delega en `inviteStaff`. — RF-1..RF-9, RF-13..RF-15
  - `PATCH /staff/:id` → `auth`; delega en `editStaff`. — RF-16..RF-19, RF-22..RF-24
  - `PATCH /staff/:id/resend-invitation` → `auth`; delega en `resendStaffInvitation`. — RF-12, RF-13
  - `PATCH /staff/:id/deactivate` → `auth`; delega en `deactivateStaff`. — RF-25..RF-29
  - `GET /staff` → `auth`; delega en `listStaff`. — RF-31..RF-33
  - `GET /staff/:id` → `auth`; delega en `getStaff`. — RF-34
- **`routes/me.js`** (nuevo) — `PATCH /me` → `auth`; delega en
  `editOwnProfile`. Ruta separada de `/staff/:id` porque el conjunto de
  campos editables y el alcance de autorización son distintos (principio 7).
  — RF-20, RF-21
- **`routes/public.js`** (modificar) — agrega
  `POST /public/staff-invitations/activate` con `{ token, password }` en el
  body; sin middleware de auth, el token se valida dentro del use case,
  mismo patrón que `POST /public/bookings`. — RF-10, RF-11
- **`middleware/auth.js`** (modificar) — después de `jwt.verify`,
  `userRepo.findById(req.user.id)` y validar `status === 'activo'`; si no,
  401. Pasa a ser asíncrono. — RF-30
- **`routes/auth.js`** (modificar) — `login` rechaza con el mismo
  `invalid_credentials` genérico si `user.status !== 'activo'` (no
  distingue `pendiente` de `inactivo` en el mensaje, para no filtrar
  estado). — impacto de RF-11/RF-30 sobre el login existente
- **`app.js`** (modificar) — montar `routes/staff.js` en `/staff` y
  `routes/me.js` en `/me`.

### `infrastructure/db`

- **`repositories/users.js`** (modificar)
  - `update(db, id, data)` — genérico, reusado por todos los use cases de
    esta spec.
  - `findManyByAccount(db, accountId, { status })` — orden alfabético por
    nombre. → RF-31, RF-32
  - `findVisible(db, { id, accountId })` — mismo patrón que
    `appointmentRepo.findVisible`. → RF-24, RF-34
- **`repositories/staffInvitationTokens.js`** (nuevo)
  - `create(db, data)`.
  - `findValidByHash(db, hash)` — `token_hash = ? AND used_at IS NULL AND expires_at > now()`.
  - `invalidateAllForUser(db, userId)` — `UPDATE ... SET used_at = now() WHERE user_id = ? AND used_at IS NULL`.
  - `markUsed(db, id)`.
  → RF-9, RF-10, RF-11, RF-12, RF-18
- **`repositories/appointments.js`** (modificar)
  - `cancelFutureForUser(db, { userId, now })` — `UPDATE appointments SET status='cancelado' WHERE assigned_user_id = ? AND status IN ('agendado','bloqueado') AND scheduled_at > ?`.
  → RF-26, RF-27

### `infrastructure/integrations`

- **`integrations/email.js`** (nuevo) — `sendInvitationEmail({ to, link })`:
  puerto único de envío. Implementación inicial hace un log estructurado
  (sin proveedor real); el contenido/plantilla está fuera de alcance de la
  spec. Punto de integración listo para swappear por un proveedor real sin
  tocar los use cases. → RF-1, RF-7, RF-8, RF-12, RF-15, RF-18

## 2. Modelo de datos

**Migración `0005_spec_002_staff_management.sql`** (hand-written, principio 8):

```sql
CREATE TYPE "user_status" AS ENUM ('pendiente', 'activo', 'inactivo');

ALTER TABLE "users" ADD COLUMN "status" user_status NOT NULL DEFAULT 'activo';
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "users"
  ADD CONSTRAINT "users_commission_rate_range"
  CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1));

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
```

- `status` con `DEFAULT 'activo'` mantiene a los usuarios existentes (todos
  altas por `register`, que ya define contraseña) sin migración de datos.
- `password_hash` nullable habilita RF-1 (un `pendiente` no tiene
  contraseña utilizable); `register`/`login` no cambian su contrato.
- El `CHECK` de comisión respalda RF-4 en la DB (principio 2), igual que
  `services_duration_positive` en la migración `0003`.
- La unicidad de email (RF-6, RF-7, RF-8, RF-22, RF-34) ya está cubierta
  por el índice único existente en `users.email` (no distingue estado) —
  no se toca.
- `db/schema.js` se actualiza con `userStatusEnum`, la columna `status`,
  `password_hash` opcional, `.check()` para el rango de comisión, y la
  tabla `staffInvitationTokens` con su relación a `users`, para que el
  snapshot de Drizzle quede consistente (`meta/_journal.json`).

## 3. Decisiones (con alternativa descartada)

- **D-P1. Estado como enum de tres valores en `users.status`, sin tabla
  aparte de invitaciones pendientes.** *Descartado:* modelar "pendiente"
  como ausencia de fila en `users` + una tabla `staff_invitations` que se
  "gradúa" a `users` al activarse — duplicaría la validación de unicidad de
  email entre dos tablas y complicaría RF-6/RF-7/RF-8, que comparan contra
  "cualquier usuario existente" con una sola fuente de verdad.
- **D-P2. Token de invitación en tabla propia `staff_invitation_tokens`
  con `used_at`, sin reusar `appointment_access_tokens`.** *Descartado:*
  generalizar esa tabla con un `token_type` polimórfico — mezclaría dos
  ciclos de vida distintos (los tokens de turno son reutilizables hasta
  vencer; los de invitación son de un solo uso) en columnas condicionales,
  justo el patrón de nulabilidad condicional que la constitución ya trata
  como problema en otro lado (migración 0004).
- **D-P3. "Invalidar cualquier enlace anterior" (RF-8, RF-12) marca
  `used_at = now()`, no borra filas.** *Descartado:* `DELETE` de tokens
  viejos — funciona igual, pero pierde el rastro de reenvíos sin necesidad;
  marcar como usado es igual de simple y no exige justificar un `DELETE`
  adicional.
- **D-P4. El envío del email ocurre dentro de la transacción de
  escritura (`db.transaction`), igual que `createPayment` en la spec
  001.** *Descartado:* enviarlo después del commit y compensar con una
  fila "pendiente de reintento" si falla — reintroduce la ventana de fallo
  parcial que RF-15 prohíbe explícitamente; el patrón de meter el efecto
  lateral dentro de la transacción ya tiene precedente en el código.
- **D-P5. `infrastructure/integrations/email.js` como puerto propio
  (log-only por ahora), sin sumar una dependencia de envío (nodemailer,
  SMTP, proveedor).** *Descartado:* integrar un proveedor real ahora — el
  contenido/plantilla del email está explícitamente fuera de alcance de la
  spec (YAGNI, principio 11) y sumar una dependencia exige justificación
  escrita (principio 1) que ningún RF pide todavía; el puerto queda listo
  para swappearse sin tocar los use cases.
- **D-P6. `middleware/auth.js` consulta `users` en cada request para
  validar `status === 'activo'` (RF-30).** *Descartado:* una blacklist de
  tokens revocados (ej. Redis) — no hay ese componente en el stack fijo
  (principio 1) y agregarlo solo para esto sería sobre-ingeniería para el
  volumen de un proyecto de portafolio; una consulta por PK ya indexada es
  suficiente.
- **D-P7. `POST /public/staff-invitations/activate` valida el token
  dentro del use case, sin middleware dedicado — mismo patrón que
  `POST /public/bookings`.** *Descartado:* un middleware `invitationAuth`
  análogo a `publicAuth` — ese middleware sirve para acciones repetibles
  sobre un recurso ya identificado (gestionar un turno); activar la cuenta
  es una acción de una sola vez que consume el token, más parecida a un
  alta anónima que a una sesión pública.
- **D-P8. Recurso nuevo `/staff` (no `/users`) para las acciones de esta
  spec.** *Descartado:* extender `routes/auth.js` o exponer `/users`
  genérico — el owner también es una fila de `users`, y esta spec gestiona
  específicamente el ciclo de vida de invitación/baja de trabajadores
  (`role: 'staff'`), no operaciones genéricas sobre cualquier usuario.
- **D-P9. El alcance por rol (403 en alta/baja/listado, 404 en ver/editar
  a otro) se resuelve en cada use case, no en un middleware
  `ownerOnly`.** *Descartado:* mismo motivo que D-P3 de la spec 001 —
  distinguir 403 de 404 exige tener el recurso cargado, y no todos los RF
  de esta spec son 403 puro (RF-24/RF-34 dependen del recurso).
- **D-P10. `PATCH /me` en una ruta separada de `PATCH /staff/:id`.**
  *Descartado:* un único endpoint que detecta "¿estoy editando mi propio
  id?" — mezclaría dos conjuntos de campos editables (RF-16 vs. RF-20/21)
  y dos alcances de autorización en un mismo handler, contra el principio
  7 ("acción con lógica propia → ruta específica").

## 4. Estrategia de tests (TDD, principio 9)

Orden: primero los tests que fallan de los casos **no obvios**; después el
CRUD básico.

### Unit — `tests/domain/` (sin DB, `node:test`)

- `userStatus.test.js` (nuevo): `pendiente→activo`, `pendiente→inactivo`,
  `activo→inactivo`, `inactivo→pendiente` válidas; `inactivo→activo`
  inválida (422). — RF-7, RF-11, RF-17, RF-25, RF-28
- `staffInvite.test.js` (nuevo): sin usuario existente → `create`; `activo`
  en cualquier cuenta → `reject`; `pendiente`/`inactivo` de otra cuenta →
  `reject`; `inactivo` misma cuenta → `reactivate`; `pendiente` misma
  cuenta → `resend`. — RF-6, RF-7, RF-8
- `staffEdit.test.js` (nuevo): `commission_rate` fuera de `[0,1]` → 422;
  `null` → válido; payload de owner vacío o con `status`/`role` → 400;
  payload de self-edit con `email`/`role`/`commission_rate` → 400. —
  RF-4, RF-19, RF-21, RF-23

### Application — `tests/application/` (repos fake, patrón de `createAppointment.test.js`)

- `inviteStaff.test.js`: rama `create` → 201 y llama
  `tokens.create` + `email.sendInvitation` dentro de la misma transacción;
  rama `reject` → 409 sin escrituras; rama `reactivate`/`resend` → 200; si
  `email.sendInvitation` tira, el stub de `db.transaction` propaga el error
  (nada queda persistido). — RF-1, RF-6, RF-7, RF-8, RF-15
- `editStaff.test.js`: trabajador `inactivo` → 422; email a uno ya
  ocupado (cualquier estado) → 409 sin reactivar; email de un `pendiente`
  → dispara reemisión; `commission_rate: null` limpia. — RF-17, RF-18,
  RF-19, RF-22
- `editOwnProfile.test.js`: `email`/`commission_rate` en el payload → 400;
  `password` nuevo → hash actualizado. — RF-20, RF-21
- `deactivateStaff.test.js`: actor `staff` (sobre sí o sobre otro) → 403
  antes de cargar el recurso; trabajador ya `inactivo` → 422; ok → llama
  `appointments.cancelFutureForUser` dentro de la misma transacción que el
  `update` de estado. — RF-25, RF-28, RF-29
- `listStaff.test.js`: actor `staff` → 403; filtro de estado se traduce a
  la condición del repo. — RF-32, RF-33
- `activateStaffAccount.test.js`: token vencido o usado → 410; token
  válido → guarda `password_hash`, `status: 'activo'`, marca el token
  usado. — RF-10, RF-11

### Integración — `tests/integration/` (Postgres real, `withAccount`)

1. Invitar → fila `pendiente` + fila en `staff_invitation_tokens` →
   activar con el token → `status: 'activo'` → login funciona. — RF-1, RF-11
2. Invitar dos veces al mismo email en la misma cuenta antes de activar →
   la segunda reenvía sobre el mismo `user_id` (el token viejo queda con
   `used_at`). — RF-8
3. Reenvío explícito invalida el token anterior (usarlo después → 410); el
   nuevo funciona. — RF-9, RF-10, RF-12
4. Dar de baja a un trabajador con un turno `agendado` y un bloqueo
   futuros asignados → ambos quedan `cancelado`; un turno `completado`
   pasado no se toca. — RF-26, RF-27
5. Trabajador dado de baja intenta usar su JWT vigente contra cualquier
   ruta protegida → 401 antes de que el token expire. — RF-30
6. `commission_rate` fuera de `[0,1]` insertado directo (bypass de la
   app) → viola el `CHECK` de la migración `0005`. — RF-4, principio 2
7. Email de un `activo` de otra cuenta → 409 en el alta; email de un
   `inactivo` de otra cuenta → también 409 (no se libera). — RF-6
8. `staff` sobre un trabajador de otra cuenta o un compañero ajeno → 404;
   `staff` intentando invitar, dar de baja o listar → 403. — RF-24, RF-29,
   RF-33, RF-34
9. `npm run db:migrate` sobre DB vacía aplica `0005`; una fila `pendiente`
   con `password_hash: null` no viola ninguna constraint. — impacto fuera
   de la spec (modelo de `users`)

### Gate

`npm test` (unit + application + integración) y `npm run db:migrate` en
verde sobre DB vacía antes de cada commit (principio 9).

## 5. Mapa RF → módulo

| RF | Dónde se cubre |
|---|---|
| RF-1, RF-2, RF-3 | `inviteStaff` (rama `create`) |
| RF-4 | `domain/staffEdit.assertValidCommissionRate` (reusado en alta y edición) |
| RF-5 | `inviteStaff` (validación de payload) |
| RF-6, RF-7, RF-8 | `domain/staffInvite.decideInviteAction` + `inviteStaff` |
| RF-9 | `staffInvitationTokenRepo.create` (`expires_at`) + `generateAccessToken` |
| RF-10 | `staffInvitationTokenRepo.findValidByHash` + `activateStaffAccount` |
| RF-11 | `activateStaffAccount` + `domain/userStatus` |
| RF-12, RF-13 | `resendStaffInvitation` |
| RF-14 | `inviteStaff` (chequeo de rol) |
| RF-15 | `inviteStaff` / `resendStaffInvitation` (envío dentro de `db.transaction`) + `integrations/email.js` |
| RF-16, RF-19 | `editStaff` + `domain/staffEdit.assertOwnerEditablePayload` |
| RF-17 | `editStaff` + `domain/userStatus` |
| RF-18 | `editStaff` (reemisión dentro de la misma transacción) |
| RF-20, RF-21 | `editOwnProfile` + `domain/staffEdit.assertSelfEditablePayload` |
| RF-22 | `editStaff` (email duplicado, sin reactivar) |
| RF-23 | `domain/staffEdit.assertOwnerEditablePayload` |
| RF-24 | `editStaff` + `userRepo.findVisible` |
| RF-25, RF-26, RF-27, RF-28 | `deactivateStaff` + `domain/userStatus` + `appointmentRepo.cancelFutureForUser` |
| RF-29 | `deactivateStaff` (chequeo de rol antes de cargar el recurso) |
| RF-30 | `middleware/auth.js` + `userRepo.findById` |
| RF-31, RF-32 | `listStaff` + `userRepo.findManyByAccount` |
| RF-33 | `listStaff` (chequeo de rol) |
| RF-34 | `getStaff` / `editStaff` / `deactivateStaff` (todos vía `userRepo.findVisible`) |
| No funcionales (email case-insensitive, concurrencia, formato de error) | `normalizeEmail` (reuso) + revalidación de estado dentro de cada transacción, mismo criterio que appointments |

## 6. Verificación

- `npm run db:migrate` limpio sobre DB vacía (aplica `0000`..`0005`).
- `npm test` verde: unit + application + integración.
- Recorrido manual (curl): invitar con comisión propia → activar cuenta
  desde el enlace → loguearse → owner edita nombre y comisión del
  trabajador → staff edita su propia contraseña desde `/me` → intenta
  cambiar su email desde `/me` (400) → owner da de baja al trabajador
  teniendo un turno y un bloqueo futuros asignados (ambos se cancelan) →
  el JWT del trabajador ya no sirve en la siguiente request (401) →
  reinvitar al mismo email (reactiva).
- Confirmar que `login` responde el mismo `invalid_credentials` genérico
  para un `pendiente`, un `inactivo` y una contraseña incorrecta (no
  filtra estado).

## 7. Archivos tocados (resumen)

- **Nuevos:** `domain/{userStatus,staffInvite,staffEdit}.js`,
  `application/{inviteStaff,resendStaffInvitation,editStaff,editOwnProfile,deactivateStaff,listStaff,getStaff,activateStaffAccount}.js`,
  `infrastructure/db/repositories/staffInvitationTokens.js`,
  `infrastructure/integrations/email.js`,
  `infrastructure/http/routes/{staff,me}.js`,
  `db/migrations/0005_spec_002_staff_management.sql`, tests unit/app/integración nuevos.
- **Modificados:** `db/schema.js`,
  `infrastructure/db/repositories/{users,appointments}.js`,
  `infrastructure/http/middleware/auth.js`,
  `infrastructure/http/routes/{auth,public,app}.js`,
  `db/migrations/meta/_journal.json`.
