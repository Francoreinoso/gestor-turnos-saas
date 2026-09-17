# Tasks 002 — Gestión de trabajadores (staff)

Deriva de `plan.md`. Tareas de <30 min, en orden de dependencia. Cada una con
sus RF y una condición verificable. TDD: donde dice "test que falla", ese
test se escribe y se ve fallar antes de implementar.

## Fase 0 — Setup y migración

- [x] **T00 · Rama + migración `0005`** — RF-4 (infraestructura para RF-1, RF-9, RF-10, RF-11)
  Crear rama `spec/002-gestion-trabajadores`. En `db/schema.js`: `userStatusEnum`, columna `status` en `users` (`default: 'activo'`), `password_hash` opcional, `.check()` de rango de comisión, tabla `staffInvitationTokens` con su relación. Escribir a mano `db/migrations/0005_spec_002_staff_management.sql` (enum, `ALTER TABLE users`, `CREATE TABLE staff_invitation_tokens` + índices) y sumar la entrada en `meta/_journal.json`.
  **Hecho cuando:** `npm run db:migrate` sobre una DB vacía aplica `0000`..`0005` sin error; en psql, `\d users` muestra `status` y el CHECK de comisión, y `\d staff_invitation_tokens` existe con sus índices.

## Fase 1 — Dominio (puro, sin dependencias)

- [x] **T01 · `domain/userStatus.js`** — RF-7, RF-11, RF-17, RF-25, RF-28
  Test que falla en `tests/domain/userStatus.test.js`, luego implementar `STATUSES`, `VALID_TRANSITIONS`, `canTransition`, `assertTransition` (422 si inválida).
  **Hecho cuando:** el test pasa cubriendo `pendiente→activo`, `pendiente→inactivo`, `activo→inactivo`, `inactivo→pendiente` válidas, y `inactivo→activo` inválida (`status: 422`).

- [x] **T02 · `domain/staffInvite.js`** — RF-6, RF-7, RF-8
  Test que falla en `tests/domain/staffInvite.test.js`, luego `decideInviteAction({ existingUser, accountId })` → `'create' | 'reject' | 'reactivate' | 'resend'`.
  **Hecho cuando:** el test cubre las 5 ramas: sin usuario → `create`; `activo` en cualquier cuenta → `reject`; `pendiente`/`inactivo` de otra cuenta → `reject`; `inactivo` misma cuenta → `reactivate`; `pendiente` misma cuenta → `resend`.

- [x] **T03 · `domain/staffEdit.js`** — RF-4, RF-19, RF-21, RF-23
  Test que falla en `tests/domain/staffEdit.test.js`, luego `assertValidCommissionRate`, `assertOwnerEditablePayload`, `assertSelfEditablePayload`.
  **Hecho cuando:** el test cubre: comisión `1.5`/`-0.1` → 422, `null` → válido; payload de owner vacío o con `status`/`role` → 400; payload de self-edit con `email`/`role`/`commission_rate` → 400.

## Fase 2 — Repositorios e integraciones

- [x] **T04 · `staffInvitationTokenRepo`** — RF-9, RF-10, RF-11, RF-12, RF-18
  Añadir a `infrastructure/db/repositories/staffInvitationTokens.js`: `create`, `findValidByHash` (`used_at IS NULL AND expires_at > now()`), `invalidateAllForUser`, `markUsed`.
  **Hecho cuando:** un test de integración corto crea dos tokens para el mismo `user_id`, invalida el primero y confirma que `findValidByHash` solo resuelve el segundo.

- [x] **T05 · `userRepo`: `update`, `findManyByAccount`, `findVisible`** — RF-24, RF-31, RF-32, RF-34
  Añadir los tres métodos a `repositories/users.js`; `findManyByAccount` acepta filtro de `status` y ordena por `name` asc.
  **Hecho cuando:** un test de integración inserta 3 usuarios de una cuenta en distintos estados; `findManyByAccount` sin filtro los devuelve los 3 ordenados por nombre, y con `{ status: 'activo' }` devuelve solo ese; `findVisible` de otra cuenta devuelve `undefined`.

- [x] **T06 · `appointmentRepo.cancelFutureForUser`** — RF-26, RF-27
  Añadir el `UPDATE` masivo: `assigned_user_id = ? AND status IN ('agendado','bloqueado') AND scheduled_at > ?` → `status: 'cancelado'`.
  **Hecho cuando:** un test de integración inserta un turno `agendado` futuro, un bloqueo futuro y un turno `completado` pasado del mismo profesional; tras `cancelFutureForUser` solo los dos primeros quedan `cancelado`.

- [x] **T07 · `infrastructure/integrations/email.js`** — soporta RF-1, RF-7, RF-8, RF-12, RF-15, RF-18
  `sendInvitationEmail({ to, link })`: log estructurado (sin proveedor real); firma `async` para que un fallo simulable (reject) sea observable por los use cases.
  **Hecho cuando:** un test unitario simple confirma que la función loguea `to` y `link`, y que puede forzarse a rechazar (mock) para los tests de rollback de la Fase 3.

## Fase 3 — Casos de uso (repos fake, test primero; patrón de `tests/application/createAppointment.test.js`)

- [x] **T08 · `inviteStaff` — validación** — RF-4, RF-5, RF-14
  Test que falla, luego: `staff` que invoca → 403; falta `name`/`email` → 400; `assertValidCommissionRate` → 422. Sin llegar a tocar `db`.
  **Hecho cuando:** el test cubre los 3 rechazos y confirma que ningún repo fue llamado.

- [x] **T09 · `inviteStaff` — rama `create` / `reject`** — RF-1, RF-2, RF-3, RF-6
  Test que falla, luego: `decideInviteAction` resuelve `create` → inserta `users` (`status: 'pendiente'`, `role: 'staff'`, comisión si vino) dentro de `db.transaction`, genera y guarda el token, llama `email.sendInvitation`, responde 201; `reject` → 409 sin escrituras.
  **Hecho cuando:** el test verifica el 201 con `status: 'pendiente'`, que `tokens.create` y `email.sendInvitation` se llamaron una vez, y que la rama `reject` no llama a ningún repo de escritura.

- [x] **T10 · `inviteStaff` — ramas `reactivate` / `resend` + rollback de envío** — RF-7, RF-8, RF-9, RF-15
  Test que falla, luego: `reactivate`/`resend` actualizan la fila existente (200) con nuevo token; si `email.sendInvitation` rechaza, el `db.transaction` fake propaga el error y no se llama a nada después.
  **Hecho cuando:** el test verifica el 200 en ambas ramas y que un rechazo de `email.sendInvitation` deja el stub de `db.transaction` sin haber confirmado ninguna escritura.

- [x] **T11 · `resendStaffInvitation`** — RF-12, RF-13
  Test que falla, luego: trabajador fuera de alcance → 404 (reusa `findVisible`); `status !== 'pendiente'` → 422; OK → invalida token anterior, crea uno nuevo, envía, 200.
  **Hecho cuando:** el test cubre 404 / 422 / 200 y confirma que `invalidateAllForUser` se llama antes de `create`.

- [x] **T12 · `editStaff` — whitelist, guarda `inactivo` y visibilidad** — RF-17, RF-23, RF-24, RF-34
  Test que falla, luego: `assertOwnerEditablePayload` → 400; trabajador `inactivo` → 422; fuera de cuenta o (staff) ajeno → 404.
  **Hecho cuando:** el test cubre los 3 rechazos antes de llegar a cualquier `update`.

- [x] **T13 · `editStaff` — email duplicado, reemisión y comisión** — RF-16, RF-18, RF-19, RF-22
  Test que falla, luego: cambio de email a uno ya ocupado (cualquier estado) → 409 sin reactivar; cambio de email de un `pendiente` → reemite invitación en la misma transacción que el `update`; `commission_rate: null` limpia.
  **Hecho cuando:** el test verifica el 409, que la reemisión llama `invalidateAllForUser` + `create` + `email.sendInvitation` dentro de la misma promesa de transacción, y que `null` persiste como tal.

- [x] **T14 · `editOwnProfile`** — RF-20, RF-21
  Test que falla, luego: `assertSelfEditablePayload` → 400 si trae `email`/`role`/`commission_rate`; `password` nuevo → `bcrypt.hash` antes de `update`.
  **Hecho cuando:** el test cubre el 400 y confirma que el hash guardado difiere de la contraseña en texto plano.

- [x] **T15 · `deactivateStaff` — guardas de rol y estado** — RF-28, RF-29
  Test que falla, luego: actor `staff` (sobre sí o sobre otro) → 403 antes de cargar el recurso; trabajador ya `inactivo` → 422.
  **Hecho cuando:** el test verifica que el 403 se dispara sin llamar a `findVisible`, y el 422 sin llamar a `update`.

- [x] **T16 · `deactivateStaff` — transición y cascada** — RF-25, RF-26, RF-27
  Test que falla, luego: `assertTransition` + `db.transaction` con `userRepo.update(status:'inactivo')` y `appointmentRepo.cancelFutureForUser`.
  **Hecho cuando:** el test confirma que ambas llamadas ocurren dentro del mismo stub de transacción y con los argumentos (`userId`, `now`) esperados.

- [x] **T17 · `listStaff`** — RF-31, RF-32, RF-33
  Test que falla, luego: `staff` → 403; traduce el filtro de estado a `findManyByAccount`.
  **Hecho cuando:** el test verifica el 403 y que el filtro `{ status: 'pendiente' }` se pasa tal cual al repo.

- [x] **T18 · `getStaff`** — RF-34
  Test que falla, luego: `findVisible` → 404 si no existe o es de otra cuenta.
  **Hecho cuando:** el test cubre el 404 y el caso feliz con el shape esperado (nombre, email, rol, comisión, estado).

- [x] **T19 · `activateStaffAccount`** — RF-10, RF-11
  Test que falla, luego: `findValidByHash` sin match → 410; OK → `db.transaction` con `update(password_hash, status:'activo')` + `markUsed`.
  **Hecho cuando:** el test cubre el 410 y confirma que `markUsed` se llama con el id del token usado.

## Fase 4 — Rutas HTTP

- [x] **T20 · `routes/staff.js` — alta, reenvío y edición** — RF-1..RF-19, RF-22..RF-24 (vía delegación)
  `POST /staff`, `PATCH /staff/:id`, `PATCH /staff/:id/resend-invitation`, `PATCH /staff/:id/editar` con `auth`, delegando en los use cases de la Fase 3. Montar el router en `app.js` bajo `/staff`.
  **Hecho cuando:** `curl` con JWT de owner invita a un trabajador (201) y edita su nombre (200); sin JWT, cualquiera de las tres responde 401.

- [x] **T21 · `routes/staff.js` — baja, listado y detalle** — RF-25..RF-29, RF-31..RF-34 (vía delegación)
  `PATCH /staff/:id/deactivate`, `GET /staff`, `GET /staff/:id` con `auth`, delegando en `deactivateStaff` / `listStaff` / `getStaff`.
  **Hecho cuando:** `curl` con JWT de owner da de baja a un trabajador (200) y lo ve `inactivo` en `GET /staff`; con JWT de staff, `GET /staff` responde 403.

- [x] **T22 · `routes/me.js`** — RF-20, RF-21
  `PATCH /me` con `auth`, delega en `editOwnProfile`. Montar en `app.js` bajo `/me`.
  **Hecho cuando:** `curl` con cualquier JWT cambia su propio nombre (200); enviar `email` en el body responde 400.

- [x] **T23 · `routes/public.js` — activar cuenta** — RF-10, RF-11
  Agregar `POST /public/staff-invitations/activate` con `{ token, password }` en el body, sin `auth` ni `publicAuth`, delegando en `activateStaffAccount`.
  **Hecho cuando:** `curl` con un token de invitación válido activa la cuenta (200); repetir con el mismo token responde 410.

- [x] **T24 · `middleware/auth.js` — validar estado activo** — RF-30
  Tras `jwt.verify`, `userRepo.findById` y validar `status === 'activo'`; si no, 401. Middleware pasa a `async`.
  **Hecho cuando:** un test de integración da de baja a un usuario y confirma que su JWT (todavía sin expirar) responde 401 en cualquier ruta protegida (ej. `GET /staff`).

- [x] **T25 · `routes/auth.js` — `login` rechaza no-`activo`** — impacto de RF-11/RF-30 sobre el login existente
  Tras encontrar el usuario por email, si `status !== 'activo'` responde el mismo `invalid_credentials` genérico (401) que credenciales inválidas.
  **Hecho cuando:** `curl` a `/auth/login` con un usuario `pendiente` y con uno `inactivo` responde 401 con el mismo cuerpo que una contraseña incorrecta.

## Fase 5 — Tests de integración (Postgres real, `withAccount`)

- [x] **T26 · Integración: alta → activar → login** — RF-1, RF-2, RF-3, RF-11
  Invitar con comisión propia → fila `pendiente` + fila en `staff_invitation_tokens` → activar con el token → `status: 'activo'` → `login` funciona.
  **Hecho cuando:** los 4 pasos encadenados pasan en un solo test.

- [x] **T27 · Integración: reenvío automático y explícito** — RF-8, RF-9, RF-10, RF-12
  Invitar dos veces al mismo email en la misma cuenta antes de activar → la segunda reenvía sobre el mismo `user_id` (token viejo con `used_at`). Reenvío explícito invalida el token anterior (usarlo después → 410); el nuevo funciona.
  **Hecho cuando:** ambos escenarios pasan y el `user_id` no cambia entre invitaciones.

- [x] **T28 · Integración: baja y cascada** — RF-25, RF-26, RF-27, RF-28
  Dar de baja a un trabajador con un turno `agendado` y un bloqueo futuros → ambos `cancelado`; un turno `completado` pasado no se toca; repetir la baja → 422.
  **Hecho cuando:** los 3 escenarios pasan en el mismo test.

- [x] **T29 · Integración: revocación de acceso** — RF-30
  Con un JWT emitido antes de la baja, cualquier request autenticado tras la baja responde 401.
  **Hecho cuando:** el test obtiene el JWT, da de baja al usuario y confirma el 401 en la siguiente request con ese mismo JWT.

- [x] **T30 · Integración: CHECK de comisión y email duplicado** — RF-4, RF-6
  Insertar `commission_rate = 1.5` directo por SQL → viola el CHECK de `0005`. Invitar con el email de un `activo` de otra cuenta → 409; con el de un `inactivo` de otra cuenta → también 409 (no se libera).
  **Hecho cuando:** los 3 escenarios pasan.

- [x] **T31 · Integración: alcance por rol** — RF-24, RF-29, RF-33, RF-34
  `staff` sobre un trabajador de otra cuenta o un compañero ajeno → 404; `staff` invitando, dando de baja o listando → 403.
  **Hecho cuando:** los 4 escenarios pasan y ninguna de las respuestas de alcance incorrecto es 403 (deben ser 404) ni viceversa.

- [x] **T32 · Integración: migración limpia** — impacto fuera de la spec (modelo de `users`)
  `npm run db:migrate` sobre DB vacía aplica `0005`; insertar un usuario `pendiente` con `password_hash: null` no viola ninguna constraint.
  **Hecho cuando:** ambas verificaciones pasan.

## Fase 6 — Documentación y cierre

- [x] **T33 · Actualizar `CLAUDE.md`** — impacto fuera de la spec
  Documentar el estado `pendiente`/`activo`/`inactivo` de `users`, que la baja de un trabajador es lógica (nunca `DELETE`), y que el middleware de auth ahora valida `status === 'activo'` en cada request.
  **Hecho cuando:** `CLAUDE.md` refleja las tres reglas y no contradice `spec.md`.

- [x] **T34 · Gate final** — todos los RF
  `npm test` completo y `npm run db:migrate` sobre DB vacía, ambos verdes. Recorrido manual con `curl` del flujo de "Criterios de finalización" de `spec.md`.
  **Hecho cuando:** ambos comandos salen con código 0 y el recorrido manual reproduce cada paso (invitar → activar → login → editar → autoedición 400 en email → baja con cascada → 401 con JWT viejo → reinvitar reactiva).

---

## Estado: implementado (163/163 tests en verde)

Un hallazgo durante T00, no previsto en el plan:

- **`users_commission_rate_check` ya existía** desde la migración `0002_late_vargas.sql` — el
  plan asumía que RF-4 necesitaba un `CHECK` nuevo en `db/schema.js` y en la migración `0005`.
  Se detectó al inspeccionar la DB después de la primera corrida de `db:migrate` (constraint
  duplicado). Se quitó el `.check()` agregado en `schema.js` y el `ADD CONSTRAINT` de la
  migración; `0005` solo agrega `status`, `password_hash` opcional y `staff_invitation_tokens`.

Recorrido manual (`curl`, servidor real en `:3001`) verificado end-to-end: alta con comisión →
enlace de invitación (capturado del log de `email.js`) → activar cuenta → login del trabajador →
`PATCH /me` (nombre ok, email → 400) → `GET /staff` como staff → 403 → owner edita al trabajador →
baja con un turno y un bloqueo futuros asignados (ambos quedan `cancelado`) → el JWT del
trabajador, todavía sin expirar, responde 401 en la siguiente request → login del trabajador dado
de baja → 401 → reinvitar al mismo email → reactiva (200) → `resend-invitation` sobre el
`pendiente` → 200 → `GET /staff/:id` de otra cuenta → 404.
