# Plan 003 — Resumen financiero y consulta de pagos

Deriva de `spec.md` (22 RF). Sin código: módulos, modelo de datos,
decisiones y estrategia de tests. Cada parte indica los RF que cubre.

## 1. Módulos

### `domain/` (puro, sin I/O)

- **`domain/paymentsPeriod.js`** (nuevo) — resolución y validación del
  filtro de período, pura (recibe `now` explícito, mismo criterio que
  `appointmentScheduling.js`):
  - `resolvePeriod({ preset, dateFrom, dateTo, now })` → `{ from, to }`.
    `preset` reconocido (`hoy`/`esta_semana`/`este_mes`) calcula los
    límites UTC exactos de RF-14; sin filtro → `este_mes` (RF-12); preset
    Y rango libre juntos → 400 `ambiguous_period_filter` (RF-13); preset
    no reconocido, o `date_from`/`date_to` no parseables → 400
    `invalid_period` (RF-18). `date_from`/`date_to` se devuelven tal cual
    (inclusive, RF-15), **incluso si `date_from > date_to`** — no hay
    chequeo especial para ese caso (RF-17 se resuelve solo, ver D-P3).
  → RF-11, RF-12, RF-13, RF-14, RF-15, RF-18
- **`domain/appointmentScheduling.js`** (modificar) — agrega
  `assertCorrectionWindow(scheduledAt, now)`: calcula el día calendario
  UTC de `scheduledAt` y su fin de ventana (23:59:59.999 UTC del día
  calendario siguiente); si `now` lo pasa, lanza `Error('correction_window_expired')`
  con `status = 422`. Misma forma que `assertTransition` (dominio, sin
  I/O, sin mensaje ambiguo).
  → RF-19, RF-20
- `domain/appointment.js`, `domain/resolveCommission.js` — sin cambios;
  `assertTransition` se reusa tal cual en `correctAppointment.js`;
  `resolveCommission` no se toca (ya decidido, D8 del spec).

### `application/` (orquesta; recibe `db` y `repos`)

- **`application/getPaymentsSummary.js`** (nuevo) — RF-1..RF-7
  1. `resolvePeriod` (`domain/paymentsPeriod.js`) → `{ from, to }`; 400 si
     inválido (RF-13, RF-18).
  2. Resuelve el alcance: `employeeId = actor.role === 'staff' ? actor.id : query.employee_id`
     — mismo patrón que `listAppointments.js:19` (RF-3, RF-7).
  3. `paymentRepo.summarize(db, { accountId, employeeId, from, to })` →
     `{ totalAmount, employeeAmount, businessAmount, paymentCount }`
     (RF-1, RF-4, RF-5, RF-6).
  4. Solo si `actor.role === 'owner'`: además
     `paymentRepo.summarizeByEmployee(db, { accountId, employeeId, from, to })`
     → `byEmployee: [...]` (RF-2, RF-3). Si `actor.role === 'staff'`, este
     paso **no se ejecuta** — no solo se omite del response, no se
     consulta (RF-7).
  5. Devuelve el objeto armado (salida 200).
- **`application/listPayments.js`** (nuevo) — RF-8..RF-10
  1. Mismo `resolvePeriod` + resolución de alcance que el paso 1/2 de
     `getPaymentsSummary` (se duplican esas ~4 líneas entre los dos use
     cases, ver D-P8 — no se extrae un tercer módulo para tan poco).
  2. `paymentRepo.findForList(db, { accountId, employeeId, from, to, limit: LIST_LIMIT + 1 })`.
  3. Si vinieron `LIST_LIMIT + 1` filas, corta a `LIST_LIMIT` y
     `hasMore: true`; si no, `hasMore: false` (RF-10).
  4. Devuelve `{ payments: [...], hasMore }` (salida 200).
  → RF-8, RF-9, RF-10
- **`application/correctAppointment.js`** (nuevo — reemplaza la lógica
  hoy inline en `routes/appointments.js:119-141`; toca spec 001, ver
  "Impacto fuera de esta spec" del `spec.md`)
  1. `appointmentRepo.findOne(db, [eq(id), eq(account_id)])` → 404 (sin
     cambios respecto a hoy).
  2. Calcula `next` (sin cambios).
  3. `assertTransition(status, next)` (`domain/appointment.js`, sin
     cambios) → 422 `invalid_status_transition`.
  4. **Nuevo:** `assertCorrectionWindow(appointment.scheduled_at, now)`
     (`domain/appointmentScheduling.js`) → 422
     `correction_window_expired`. Se ejecuta antes de abrir la
     transacción, igual criterio que el resto de validaciones.
  5. `db.transaction`: mismo cuerpo que hoy (`update` status +
     `createPayment` o `payments.deleteByAppointment`), sin cambios.
  → RF-19, RF-20 (pasos 1-3 y 5 son el comportamiento ya existente de
  spec 001, solo se mueven de la ruta al use case)

### `infrastructure/http`

- **`routes/payments.js`** (nuevo)
  - `GET /payments/summary` → `auth`; delega en `getPaymentsSummary`
    (query: `period`, `date_from`, `date_to`, `employee_id`). — RF-1..RF-7,
    RF-11..RF-18, RF-21
  - `GET /payments` → `auth`; delega en `listPayments` (mismos query
    params). — RF-8..RF-10, RF-11..RF-18, RF-21
- **`routes/appointments.js`** (modificar) — `PATCH /:id/correct` pasa a
  delegar en `correctAppointment(db, { id, accountId, now: new Date() }, repos)`
  en vez de tener la lógica inline. — RF-19, RF-20
- **`app.js`** (modificar) — montar `routes/payments.js` en `/payments`.

### `infrastructure/db`

- **`repositories/payments.js`** (modificar) — agrega:
  - `summarize(db, { accountId, employeeId, from, to })` —
    `SELECT COALESCE(SUM(amount),0), COALESCE(SUM(employee_amount),0), COALESCE(SUM(business_amount),0), COUNT(*)`
    de `payments` con `innerJoin(appointments, eq(payments.appointment_id, appointments.id))`,
    `WHERE account_id = ? [AND assigned_user_id = ?] AND appointments.scheduled_at BETWEEN ? AND ?`.
    → RF-1, RF-4, RF-5, RF-6, RF-16
  - `summarizeByEmployee(db, { accountId, employeeId, from, to })` — igual
    query, agrega `GROUP BY payments.assigned_user_id` + join a `users`
    (nombre) + los mismos `COALESCE(SUM(...))`. Filas sin
    `assigned_user_id` (no debería ocurrir, RF-22 del spec no las
    contempla) se excluyen del `GROUP BY`, consistente con "por cada
    profesional con al menos un pago". → RF-2, RF-3
  - `findForList(db, { accountId, employeeId, from, to, limit })` — join a
    `appointments` (para `scheduled_at`, filtro y orden) y a `users`
    (nombre del profesional), `orderBy` `scheduled_at` desc, `limit`.
    → RF-8, RF-9, RF-16
  - `create`, `deleteByAppointment` — sin cambios.

## 2. Modelo de datos

**No se agrega ninguna migración.** `db/schema.js` no cambia.

- El resumen y el listado son lecturas puras sobre `payments` +
  `appointments`, con columnas que ya existen (`amount`,
  `employee_amount`, `business_amount`, `assigned_user_id`, y
  `appointments.scheduled_at` vía join) — D5/D6 del `spec.md` ya
  descartaron zona horaria configurable y método de pago/moneda.
- RF-19/RF-20 (ventana de corrección) es una comparación en memoria entre
  `appointment.scheduled_at` (ya en la fila) y `now` — no se persiste
  ningún estado de "período cerrado" ni se agrega columna a `appointments`
  ni a `payments` (D8 del spec: sin campo nuevo, sin concepto de "tipo de
  empleo" en el modelo).
- Última migración real del proyecto: `0005_spec_002_staff_management.sql`.
  No hay `0006` para esta spec.

## 3. Decisiones (con alternativa descartada)

- **D-P1. Agregación en SQL (`SUM`/`GROUP BY`/join, primera vez en el
  proyecto) en vez de traer filas y sumar en JS.** *Descartado:* pedir
  todas las filas del período (`findMany` + `with`, como
  `appointmentRepo.findForList`) y reducir en la aplicación — más simple
  de escribir (reusa el estilo de query-API relacional ya usado en todo
  el proyecto) pero no escala con el volumen de pagos de una cuenta
  vieja, y reimplementa en JS algo que Postgres ya hace gratis: `SUM`
  ignora `NULL` de forma nativa, que es exactamente el comportamiento que
  D8 del spec pide para los pagos de "contrato fijo" (no suman a
  profesional/negocio porque esas dos columnas son `NULL`) sin ningún
  `if` especial en el código.
- **D-P2. `findForList` pide `limit + 1` filas para saber si "hay más"
  (RF-10), sin `COUNT(*)` aparte.** *Descartado:* una segunda query
  `COUNT(*)` sobre el mismo filtro — dos round-trips a la DB por una sola
  respuesta; pedir una fila de más y cortarla en `listPayments` es una
  sola query y el costo extra es insignificante frente al límite ya fijo.
- **D-P3. `domain/paymentsPeriod.resolvePeriod` nunca chequea
  `date_from > date_to` — devuelve el rango tal cual (RF-17).**
  *Descartado:* un chequeo explícito que corte antes de llegar a la DB,
  como hace `listAppointments.js:22`
  (`if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) return [];`)
  — acá hay que vaciar el resumen (montos en `0`) Y el listado (array
  vacío), dos formas de "vacío" distintas; dejar que la propia condición
  `BETWEEN`/`gte`+`lte` de cada query no matchee ninguna fila resuelve
  ambos casos sin duplicar el chequeo en dos use cases ni en el dominio.
- **D-P4. Se extrae `PATCH /:id/correct` a `application/correctAppointment.js`
  en vez de agregar `assertCorrectionWindow` inline en la ruta (como está
  hoy toda su lógica).** *Descartado:* agregar la nueva validación
  directo en `routes/appointments.js:128`, sin extraer nada — diff más
  chico, pero deja a `/correct` como la única acción de turnos que sigue
  con su lógica inline en la ruta (todas las demás — crear, editar,
  cancelar, reprogramar — ya delegan en `application/`, principio 3) y
  sin forma de testearla como caso de uso con repos fake
  (`tests/application/`), solo vía integración; se extrae ahora que de
  todos modos hay que tocarla.
- **D-P5. Dos rutas nuevas separadas — `GET /payments/summary` (resumen +
  desglose siempre juntos, D1 del spec) y `GET /payments` (listado) — en
  vez de una sola ruta con un parámetro de modo.** *Descartado:* una
  única ruta que cambia de forma según un query flag (`?detail=true`) —
  la spec ya resolvió que el resumen SIEMPRE trae el desglose (D1), así
  que no hay "modo sin desglose" que amerite un flag; el resumen y el
  listado son consultas genuinamente distintas (totales vs. filas, con
  su propio límite RF-10) — mismo criterio que la constitución, principio
  7 ("acción con lógica propia → ruta específica").
- **D-P6. El filtro por `employee_id` (RF-4/D10 del spec) no valida antes
  contra `users` que el profesional exista o pertenezca a la cuenta.**
  *Descartado:* `userRepo.findVisible(db, { id, accountId })` antes de
  armar el filtro, para distinguir "no existe" de "es de otra cuenta" —
  trabajo extra (una query más) para llegar exactamente al mismo
  resultado vacío, porque un `WHERE assigned_user_id = ? AND account_id = ?`
  sobre un id ajeno o inexistente ya no matchea nada por construcción
  (coincide con D10: mismo tratamiento para ambos motivos).
- **D-P7. `assertCorrectionWindow` vive en `domain/appointmentScheduling.js`
  (junto a `computeEndsAt`/`resolveInitialStatus`), no en
  `domain/appointment.js` (junto a `assertTransition`).** *Descartado:*
  agregarla a `domain/appointment.js` porque se invoca en el mismo flujo
  HTTP que `assertTransition` — se prefiere agrupar por la naturaleza de
  la regla (puramente temporal, compara fechas con `now` explícito, misma
  convención que `resolveInitialStatus`) en vez de por el endpoint que la
  llama; `assertTransition` sigue viviendo en `appointment.js` porque es
  sobre estados, no sobre tiempo.
- **D-P8. La resolución de alcance por rol (`employeeId` forzado a
  `actor.id` si es `staff`) se duplica entre `getPaymentsSummary.js` y
  `listPayments.js` (2-3 líneas), sin extraer un tercer módulo
  compartido.** *Descartado:* un `domain/paymentsScope.js` o
  `application/resolvePaymentsQuery.js` que centralice `resolvePeriod` +
  la resolución de `employeeId` — para dos líneas de lógica trivial
  (idéntica al patrón ya usado inline en `listAppointments.js:19`, que
  tampoco lo extrajo a un módulo aparte) no se justifica una abstracción
  nueva (principio 11, YAGNI); `resolvePeriod` sí se comparte porque
  encapsula una regla real con varios casos (RF-11..RF-18), no una
  asignación condicional de una línea.

## 4. Estrategia de tests (TDD, principio 9)

Orden: primero los tests que fallan de los casos **no obvios** (montos que
no cuadran, ventana de corrección, alcance por rol); después el CRUD/
lectura básica.

### Unit — `tests/domain/` (sin DB, `node:test`)

- `paymentsPeriod.test.js` (nuevo): límites exactos de `hoy`/`esta_semana`/
  `este_mes` con `now` fijo; sin filtro → `este_mes`; preset + rango libre
  juntos → 400; preset inválido → 400; `date_from`/`date_to` no parseables
  → 400; `date_from > date_to` → **no** tira, devuelve el rango tal cual
  (D-P3). — RF-11, RF-12, RF-13, RF-14, RF-15, RF-18
- `appointmentScheduling.test.js` (modificar, agrega casos):
  `assertCorrectionWindow` — mismo día del turno → ok; día calendario
  siguiente hasta 23:59:59.999 UTC → ok; un milisegundo después de esa
  ventana → 422 `correction_window_expired`; frontera exacta entre
  "todavía ok" y "ya vencido". — RF-19, RF-20

### Application — `tests/application/` (repos fake, patrón de `listAppointments.test.js`)

- `getPaymentsSummary.test.js` (nuevo): owner sin `employee_id` → llama
  `summarize` y `summarizeByEmployee` sin filtro; owner con `employee_id`
  → ambos con ese filtro; staff → `employeeId` forzado a `actor.id` y
  `summarizeByEmployee` **nunca se llama** (verificable con spy que
  registra si el método fue invocado); período inválido → 400 antes de
  tocar el repo. — RF-1..RF-7, RF-13, RF-18
- `listPayments.test.js` (nuevo): pasa `limit: LIST_LIMIT + 1` al repo;
  repo devuelve `LIST_LIMIT + 1` filas → response con `LIST_LIMIT` filas y
  `hasMore: true`; repo devuelve menos → `hasMore: false`; staff fuerza
  `employeeId`. — RF-8, RF-9, RF-10
- `correctAppointment.test.js` (nuevo): ventana vencida → 422 antes de
  abrir transacción (spy confirma que `appointments.update`,
  `createPayment` y `payments.deleteByAppointment` **no** se llamaron);
  dentro de ventana → sigue el flujo existente sin cambios (update +
  create/delete de payment). — RF-19, RF-20

### Integración — `tests/integration/` (Postgres real, `withAccount`)

1. Resumen del owner en un período con pagos de 2 profesionales con
   distinta comisión (una del usuario, otra heredada de la cuenta) →
   totales y desglose correctos, incluido el monto al negocio por
   profesional. — RF-1, RF-2
2. Pago de "contrato fijo" (ni el usuario ni la cuenta tienen
   `commission_rate`) → cuenta en el total facturado y en el total
   generado de ese profesional en el desglose; no se suma a profesional
   ni a negocio en los totales. — RF-5
3. Resumen del staff → nunca trae `byEmployee` ni el consolidado del
   negocio; pasando `employee_id` de un compañero por query string, la
   respuesta sigue siendo la propia. — RF-6, RF-7
4. Listado del staff → cada fila incluye el monto que le dejó al negocio
   en sus propios pagos. — RF-8, RF-9
5. Filtro por un profesional de otra cuenta y por uno inexistente → mismo
   resultado vacío (200) en ambos casos, sin distinguir motivo. — RF-4
6. Período sin ningún pago → resumen con todos los montos en `0` (nunca
   `NULL`) y listado vacío. — RF-1 (caso límite)
7. Más pagos que `LIST_LIMIT` en el período → el listado corta y devuelve
   `hasMore: true`; el resumen del mismo período sigue sumando **todos**
   los pagos, no solo los que entraron en el listado. — RF-10
8. Corregir un turno `completado` de hoy a `no_llego` → ok, se borra el
   pago; el mismo turno al día calendario siguiente (todavía dentro de
   ventana) → ok; tres días después → 422, el pago no se toca. — RF-19
9. Corrección en sentido inverso (`no_llego → completado`) fuera de
   ventana → también 422, no solo la dirección que borra el pago. — RF-20
10. `npm run db:migrate` sobre DB vacía sigue aplicando limpio hasta
    `0005` (no hay `0006` que agregar) — confirma que esta spec no rompe
    nada del modelo existente. — impacto fuera de la spec

### Gate

`npm test` (unit + application + integración) en verde antes de cada
commit (principio 9). No aplica `npm run db:migrate` adicional — no hay
migración nueva en esta spec.

## 5. Mapa RF → módulo

| RF | Dónde se cubre |
|---|---|
| RF-1 | `getPaymentsSummary` + `paymentRepo.summarize` |
| RF-2, RF-3 | `getPaymentsSummary` + `paymentRepo.summarizeByEmployee` |
| RF-4 | `paymentRepo.summarize`/`summarizeByEmployee`/`findForList` (filtro que no matchea → vacío por construcción, D-P6) |
| RF-5 | `paymentRepo.summarize`/`summarizeByEmployee` (`SUM` ignora `NULL` nativamente, D-P1) |
| RF-6 | `getPaymentsSummary` (mismo query que RF-1, acotado a `actor.id`) |
| RF-7 | `getPaymentsSummary` (staff nunca llama `summarizeByEmployee`) |
| RF-8 | `listPayments` + `paymentRepo.findForList` |
| RF-9 | `listPayments` (mismo `resolvePeriod` + alcance que `getPaymentsSummary`) |
| RF-10 | `paymentRepo.findForList` (`limit + 1`, D-P2) + `listPayments` (corta y marca `hasMore`) |
| RF-11, RF-12, RF-13, RF-14, RF-15, RF-18 | `domain/paymentsPeriod.resolvePeriod` |
| RF-16 | `paymentRepo.summarize`/`summarizeByEmployee`/`findForList` (join a `appointments`, filtran/ordenan por `scheduled_at`) |
| RF-17 | Condición `WHERE` de cada query del repo (D-P3 — el dominio no interviene) |
| RF-19, RF-20 | `domain/appointmentScheduling.assertCorrectionWindow` + `application/correctAppointment` |
| RF-21 | `routes/payments.js` (usa `req.user.account_id`/`req.user.role`, nunca query string) |
| RF-22 | `routes/payments.js` (solo `GET`) + `application/correctAppointment` (la única escritura relacionada, en una ruta que no es de esta spec) |

## 6. Verificación

- `npm test` en verde (no hay migración nueva que correr).
- Recorrido manual (curl):
  1. Owner: `GET /payments/summary?period=este_mes` → total + desglose por
     profesional.
  2. Mismo owner: `GET /payments/summary?period=este_mes&employee_id=<id>`
     → desglose reducido a ese profesional.
  3. Login como ese profesional (staff): `GET /payments/summary` sin
     filtro → sus propios números, sin `byEmployee` ni consolidado.
  4. Mismo staff: `GET /payments?employee_id=<compañero>` → igual devuelve
     solo sus propios pagos (filtro ignorado).
  5. `PATCH /appointments/:id/correct` sobre un turno `completado` de hace
     tres días → 422 `correction_window_expired`; el mismo turno del día
     de hoy → 200, corrige a `no_llego` y borra el pago.

## 7. Archivos tocados (resumen)

- **Nuevos:** `domain/paymentsPeriod.js`,
  `application/{getPaymentsSummary,listPayments,correctAppointment}.js`,
  `infrastructure/http/routes/payments.js`, tests nuevos en
  `tests/domain/paymentsPeriod.test.js`,
  `tests/application/{getPaymentsSummary,listPayments,correctAppointment}.test.js`,
  casos nuevos en `tests/integration/` (ampliando `appointmentsCrud.test.js`
  o `appointments.test.js` para RF-19/RF-20, más un archivo de integración
  para el resumen/listado de pagos).
- **Modificados:** `domain/appointmentScheduling.js` (agrega
  `assertCorrectionWindow`), `infrastructure/db/repositories/payments.js`
  (agrega `summarize`, `summarizeByEmployee`, `findForList`),
  `infrastructure/http/routes/appointments.js` (`PATCH /:id/correct`
  delega en `correctAppointment`), `infrastructure/http/app.js` (monta
  `/payments`), `tests/domain/appointmentScheduling.test.js`.
- **Sin cambios (confirmado explícitamente):** `db/schema.js`,
  `domain/{appointment,resolveCommission}.js`, migraciones existentes.
