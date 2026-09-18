# Tasks 003 — Resumen financiero y consulta de pagos

Deriva de `plan.md`. Tareas de <30 min, en orden de dependencia. Cada una con
sus RF y una condición verificable. TDD: donde dice "test que falla", ese
test se escribe y se ve fallar antes de implementar.

## Fase 0 — Setup

- [x] **T00 · Rama** — infraestructura (sin RF propio)
  Crear rama `spec/003-resumen-financiero-pagos` sobre `main` (o sobre la
  rama donde vive la spec 002, según corresponda). No hay migración que
  generar (plan.md §2: el modelo de datos no cambia).
  **Hecho cuando:** rama creada; `npm run db:migrate` sobre una DB vacía
  aplica `0000`..`0005` sin error, sin ninguna migración `0006`.

## Fase 1 — Dominio (puro, sin dependencias)

- [x] **T01 · `domain/paymentsPeriod.js` — presets y default** — RF-11, RF-12, RF-14
  Test que falla en `tests/domain/paymentsPeriod.test.js`, luego
  `resolvePeriod({ preset, dateFrom, dateTo, now })`: calcula los límites
  UTC exactos de `hoy` / `esta_semana` (lunes a domingo) / `este_mes`
  usando `now` fijo; sin ningún filtro, usa `este_mes`.
  **Hecho cuando:** el test cubre los 3 presets con al menos un `now` fijo
  cerca de cada borde (ej. `now` un lunes a las 00:00:00.000 UTC) y el
  caso sin filtro devolviendo el rango de `este_mes`.

- [x] **T02 · `domain/paymentsPeriod.js` — validaciones y rango libre** — RF-13, RF-15, RF-17, RF-18
  Mismo archivo/test, agrega casos: preset y rango libre juntos → 400
  `ambiguous_period_filter`; preset no reconocido o fechas no parseables →
  400 `invalid_period`; rango libre válido se devuelve tal cual
  (inclusive); `date_from > date_to` **no** tira excepción, se devuelve
  igual (plan.md D-P3).
  **Hecho cuando:** el test cubre los 2 rechazos con 400 y confirma que
  `date_from > date_to` no lanza y devuelve `{ from: dateFrom, to: dateTo }`
  sin modificar.

- [x] **T03 · `domain/appointmentScheduling.js` — `assertCorrectionWindow`** — RF-19, RF-20
  Test que falla en `tests/domain/appointmentScheduling.test.js` (agrega
  casos al archivo existente), luego `assertCorrectionWindow(scheduledAt, now)`:
  ok hasta las 23:59:59.999 UTC del día calendario siguiente al de
  `scheduledAt`; pasado ese instante, lanza `Error('correction_window_expired')`
  con `status: 422`.
  **Hecho cuando:** el test cubre el mismo día, el día siguiente hasta el
  último milisegundo (ok), y un milisegundo después (422) — la frontera
  exacta, no solo "un día antes/después".

## Fase 2 — Repositorios (agregación SQL nueva, plan.md D-P1)

- [x] **T04 · `paymentRepo.summarize`** — RF-1, RF-4, RF-5, RF-6, RF-16
  `summarize(db, { accountId, employeeId, from, to })`: `SELECT
  COALESCE(SUM(amount),0), COALESCE(SUM(employee_amount),0),
  COALESCE(SUM(business_amount),0), COUNT(*)` de `payments` con
  `innerJoin(appointments)` filtrando por `account_id`, `employee_id`
  opcional y `appointments.scheduled_at BETWEEN from AND to`.
  **Hecho cuando:** un test de integración corto inserta un turno
  completado con comisión resuelta y otro sin comisión ("contrato fijo")
  en el mismo período; `summarize` devuelve el total facturado sumando
  ambos, pero el monto de profesionales/negocio solo refleja el primero
  (nunca `NULL`).

- [x] **T05 · `paymentRepo.summarizeByEmployee`** — RF-2, RF-3
  Misma query que T04 con `GROUP BY payments.assigned_user_id` + join a
  `users` para el nombre; una fila por profesional con al menos un pago.
  **Hecho cuando:** un test de integración con pagos de 2 profesionales en
  el período devuelve 2 filas, cada una con generado/propio/al-negocio
  correctos; filtrando por `employeeId` de uno de ellos devuelve solo esa
  fila.

- [x] **T06 · `paymentRepo.findForList`** — RF-8, RF-9, RF-16
  Join a `appointments` (filtro y `orderBy scheduled_at desc`) y a `users`
  (nombre del profesional); acepta `limit` tal cual lo pida el caller
  (plan.md D-P2: pedir `limit + 1` es responsabilidad de `listPayments`,
  no del repo).
  **Hecho cuando:** un test de integración inserta 3 pagos en fechas de
  turno distintas y confirma que `findForList` con `limit: 2` devuelve
  los 2 más recientes por `scheduled_at`, no por `created_at`.

## Fase 3 — Casos de uso (repos fake, test primero; patrón de `tests/application/listAppointments.test.js`)

- [x] **T07 · `getPaymentsSummary` — validación de período y alcance por rol** — RF-3, RF-6, RF-7, RF-13, RF-18
  Test que falla, luego: período inválido → 400 antes de tocar cualquier
  repo; `employeeId = actor.role === 'staff' ? actor.id : query.employee_id`
  (mismo patrón que `listAppointments.js:19`).
  **Hecho cuando:** el test confirma que un período inválido no llama a
  ningún repo, y que un `actor` `staff` con `employee_id` de otro en la
  query igual resuelve `employeeId` a su propio id.

- [x] **T08 · `getPaymentsSummary` — arma la respuesta** — RF-1, RF-2, RF-4, RF-5
  Test que falla, luego: siempre llama `paymentRepo.summarize`; llama
  `paymentRepo.summarizeByEmployee` **solo si** `actor.role === 'owner'`
  (para `staff`, ese método no se invoca, no solo se omite del response).
  **Hecho cuando:** el test verifica con un spy que `summarizeByEmployee`
  se llama para `owner` y **nunca** para `staff`, en ambos casos con el
  mismo `employeeId`/período resuelto en T07.

- [x] **T09 · `listPayments`** — RF-8, RF-9, RF-10
  Test que falla, luego: mismo período/alcance que T07; pide
  `limit: LIST_LIMIT + 1` al repo; si vienen `LIST_LIMIT + 1` filas, corta
  a `LIST_LIMIT` y devuelve `hasMore: true`; si no, `hasMore: false`.
  **Hecho cuando:** el test cubre ambos casos (`LIST_LIMIT + 1` filas del
  repo fake vs. menos) y confirma el valor exacto de `hasMore` en cada
  uno.

- [x] **T10 · `correctAppointment.js` — extracción + ventana nueva** — RF-19, RF-20
  Test que falla, luego: mover la lógica de `routes/appointments.js:119-141`
  tal cual (findOne → 404, calcula `next`, `assertTransition`) y agregar
  `assertCorrectionWindow(appointment.scheduled_at, now)` **antes** de
  abrir `db.transaction`.
  **Hecho cuando:** el test confirma que, con `now` fuera de ventana, ni
  `appointments.update` ni `createPayment`/`payments.deleteByAppointment`
  se llaman (falla antes de la transacción); dentro de ventana, el flujo
  se comporta igual que antes de esta spec.

## Fase 4 — Rutas HTTP

- [x] **T11 · `routes/payments.js` + montaje** — RF-1..RF-10, RF-11..RF-18, RF-21 (vía delegación)
  `GET /payments/summary` y `GET /payments` con `auth`, delegando en
  `getPaymentsSummary`/`listPayments` (query: `period`, `date_from`,
  `date_to`, `employee_id`). Montar en `app.js` bajo `/payments`.
  **Hecho cuando:** `curl` con JWT de owner a `GET /payments/summary`
  responde 200 con el shape esperado (totales + `byEmployee`); sin JWT,
  401.

- [x] **T12 · `routes/appointments.js` — `/correct` delega** — RF-19, RF-20
  `PATCH /:id/correct` pasa a llamar `correctAppointment(db, { id,
  accountId, now: new Date() }, repos)` en vez de tener la lógica inline.
  **Hecho cuando:** `curl` sobre un turno `completado` de hoy corrige a
  `no_llego` (200, igual que antes de esta spec); sobre uno de hace tres
  días responde 422 `correction_window_expired`.

## Fase 5 — Tests de integración (Postgres real, `withAccount`)

- [x] **T13 · Integración: resumen con desglose por 2 profesionales** — RF-1, RF-2
  Un profesional con comisión propia, otro heredando la de la cuenta;
  pagos de ambos en el período.
  **Hecho cuando:** el resumen del owner trae los totales correctos y
  `byEmployee` con 2 filas, cada una con generado/propio/al-negocio
  correctos.

- [x] **T14 · Integración: pago de "contrato fijo"** — RF-5
  Profesional sin `commission_rate` propia, cuenta sin `commission_rate`
  por defecto.
  **Hecho cuando:** el pago cuenta en el total facturado y en el generado
  de ese profesional en `byEmployee`; no se suma a los totales de
  profesionales ni de negocio.

- [x] **T15 · Integración: alcance del staff** — RF-6, RF-7, RF-8, RF-9
  Login como el profesional; pide su propio resumen y listado; intenta
  forzar `employee_id` de un compañero por query string.
  **Hecho cuando:** el resumen del staff nunca trae `byEmployee` ni el
  consolidado; el listado solo tiene sus propios pagos (con el monto al
  negocio visible en cada fila propia); el filtro forzado se ignora.

- [x] **T16 · Integración: filtro de profesional fuera de alcance** — RF-4
  Filtrar por un `employee_id` de otra cuenta y por uno que no existe en
  absoluto.
  **Hecho cuando:** ambos casos devuelven 200 con resumen en cero y
  listado vacío, sin distinguirse entre sí.

- [x] **T17 · Integración: período sin pagos** — RF-1 (caso límite)
  Consultar un período sin ningún pago registrado.
  **Hecho cuando:** todos los montos del resumen son `0` (nunca `NULL`),
  `paymentCount: 0`, `byEmployee: []`, listado vacío.

- [x] **T18 · Integración: listado por encima del límite** — RF-10
  Insertar más pagos que `LIST_LIMIT` en el período.
  **Hecho cuando:** el listado devuelve `LIST_LIMIT` filas y
  `hasMore: true`; el resumen del mismo período sigue sumando **todos**
  los pagos insertados, no solo los que entraron en el listado.

- [x] **T19 · Integración: ventana de corrección, ambos sentidos** — RF-19, RF-20
  Turno `completado` de hoy → corregir a `no_llego` (ok); mismo turno al
  día calendario siguiente (ok, todavía dentro de ventana); tres días
  después (422). Repetir en sentido inverso (`no_llego` → `completado`)
  fuera de ventana.
  **Hecho cuando:** los 4 escenarios pasan en el mismo test y el pago
  correspondiente no se crea/borra cuando la respuesta es 422.

- [x] **T20 · Integración: migración limpia** — impacto fuera de la spec
  `npm run db:migrate` sobre DB vacía sigue aplicando `0000`..`0005` sin
  error.
  **Hecho cuando:** el comando sale con código 0 y no hay ninguna
  migración `0006` en el repo.

## Fase 6 — Documentación y cierre

- [x] **T21 · Actualizar `CLAUDE.md`** — impacto fuera de la spec
  Documentar la ventana de un día calendario UTC para la corrección
  `completado ↔ no_llego`, y que existe un endpoint de solo lectura de
  pagos (`/payments`, `/payments/summary`) con alcance distinto por rol.
  **Hecho cuando:** `CLAUDE.md` refleja ambas reglas y no contradice
  `spec.md`.

- [x] **T22 · Gate final** — todos los RF
  `npm test` completo en verde (no hay `npm run db:migrate` adicional que
  correr — sin migración nueva). Recorrido manual con `curl` de la
  sección "Verificación" de `plan.md`.
  **Hecho cuando:** `npm test` sale con código 0 y el recorrido manual
  reproduce cada paso (resumen del owner con desglose → filtro por
  profesional → mismo resumen como staff, sin consolidado → filtro
  forzado ignorado → corrección fuera de ventana → 422).
