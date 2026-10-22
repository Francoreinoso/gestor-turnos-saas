# Plan 010 — Agenda operativa y pagos en el panel

Deriva de `spec.md` (27 RF). Sin migraciones ni dependencias nuevas. Un cambio de backend (alcance de `correct`); el resto es frontend sobre endpoints existentes. Cada parte indica los RF que cubre.

## 1. Backend

- **`application/correctAppointment.js`** (modificar) — recibe `actor` y, tras cargar el turno, aplica el mismo patrón de `getAppointment`/`editAppointment`: `actor.role === 'staff' && appointment.assigned_user_id !== actor.id` → 404 `not_found`, **antes** de `assertTransition` y de abrir la transacción (así el staff ajeno no distingue un turno inexistente de uno ajeno, ni obtiene 422). Un bloqueo de negocio (`assigned_user_id` nulo) también es 404 para el staff. → RF-1
- **`routes/appointments.js`** (modificar) — `correct` pasa `actor: actorOf(req)`. → RF-1
- **Sin cambios** en `cancel`, `cancel-block`, `GET/PATCH /:id` (ya acotados; solo se cubren con el test de recorrido). → RF-2
- **Documentación**: README, límite de la ventana de corrección en UTC (RF-27).

## 2. Frontend

### `domain/` (puro, con tests)
- **`domain/day.ts`** — `localDayRange(date)` → `{ from, to }` ISO del día local (ya existe `toDateRange` en `DashboardPage`; se extrae y se prueba con TZ UTC y America/Santiago, incluido el día del cambio de hora); `localPeriod(preset, now)` para `hoy | esta_semana (lunes–domingo) | este_mes` y rangos libres, todos en hora local. → RF-3, RF-20
- **`domain/appointmentActions.ts`** — `availableActions(appointment, actor, now)` → conjunto de `cancel | edit | markNoShow | markCompleted | cancelBlock`: `cancel`/`edit` solo en `agendado`; `markNoShow` en `completado`, `markCompleted` en `no_llego`, ambos dentro de `isCorrectable(scheduled_at, now)`; `cancelBlock` en `bloqueado`. `isCorrectable` replica `assertCorrectionWindow` (hasta 23:59:59.999 UTC del día siguiente) con los mismos casos de borde que `tests/domain/appointmentScheduling.test.js`. → RF-13, RF-15, RF-17, RF-19
- **`domain/appointmentForm.ts`** — `buildPanelAppointment(form)` arma el cuerpo de `POST /appointments` (`client_id` xor `client`, `employee_id` solo si el owner eligió uno, `scheduled_at` ISO desde fecha y hora locales) y `validateBlock(form)` (`fin > inicio`); `clientMatches(client, query)` para la búsqueda por nombre, email o teléfono sin distinguir mayúsculas ni tildes. → RF-7, RF-8, RF-11, RF-16
- **`domain/availabilityCheck.ts`** — `isWithinSchedule(start, end, windows)` sobre el horario semanal (convertido con `groupByDay` de la spec 009) para la advertencia no bloqueante. → RF-12
- **`domain/payments.ts`** — `formatMoney` (reusa `formatPrice`), `paymentRow(payment)` con el caso "Sin comisión definida" cuando `employee_amount` es `null`; `summaryCards(summary, role)`. → RF-21..RF-24
- **`domain/errors.ts`** (modificar) — `managementErrorMessage` suma `appointment_overlap`, `no_professional_available`, `service_not_found`, `professional_not_found`, `client_not_found`, `correction_window_expired`, `invalid_status_transition`, `invalid_date`, `invalid_period`, `ambiguous_period_filter`. → RF-10, RF-17

### `services/`
- **`services/appointments.ts`** (modificar) — ya existe `list`; suma `create`, `block`, `cancel`, `cancelBlock`, `correct`, `edit`. → RF-7..RF-19
- **`services/clients.ts`** (nuevo) — `list()`. → RF-8
- **`services/payments.ts`** (nuevo) — `summary(query)`, `list(query)`. Tipos nuevos en `domain/types.ts`: `Payment`, `PaymentsSummary`, `EmployeeSummary`, `PaymentsPage { payments, hasMore }`. → RF-20..RF-23
- **`services/staff.ts`** (spec 009) — `list` y `getAvailability` alimentan el filtro y la advertencia.

### `components/`
- **`AppointmentCard.tsx`** — fila de la agenda: hora (24 h), cliente/"Bloqueo", servicio, profesional (owner), estado con etiqueta de texto además del color, y los botones de `availableActions`. → RF-3, RF-13..RF-19
- **`AppointmentForm.tsx`** — formulario de nuevo turno con `ClientPicker` (existente vs. nuevo), servicio, fecha/hora, profesional (owner) y notas; advertencia de horario (RF-12). Reusado en edición con los campos permitidos. → RF-7..RF-12, RF-19
- **`ClientPicker.tsx`** — búsqueda con lista filtrada y modo "Cliente nuevo". → RF-8
- **`BlockForm.tsx`** — bloqueo: "Todo el negocio"/profesional (owner), fecha, desde, hasta, nota. → RF-14, RF-16
- **`PeriodPicker.tsx`** — "Hoy / Esta semana / Este mes / Rango" con dos `<input type="date">`; emite `{ from, to }` ISO local. → RF-20
- **`SummaryCards.tsx`** y **`PaymentsTable.tsx`** — tarjetas del resumen y detalle (en 360 px la tabla se vuelve lista de tarjetas). → RF-21..RF-24, RF-26
- **`ConfirmDialog.tsx`, `ErrorNote.tsx`** — de la spec 009.

### `pages/`
- **`DashboardPage.tsx`** (rehacer, mantiene las rutas `/owner/agenda`, `/staff/agenda`) — navegación por día (ya existe), filtro de profesional (owner), lista de `AppointmentCard`, botones "Nuevo turno" y "Bloquear horario", estado vacío, aviso de 500; las acciones actualizan la lista localmente y confirman con un mensaje `role="status"`. → RF-3..RF-6, RF-9, RF-13..RF-19
- **`PaymentsPage.tsx`** (`/owner/pagos` y `/staff/pagos`) — `PeriodPicker`, `SummaryCards`, desglose por profesional y filtro (owner), `PaymentsTable`, aviso `hasMore`. Dos llamadas en paralelo (resumen y detalle). → RF-20..RF-25
- **`AppNav.tsx`** (spec 009) — suma "Pagos" para ambos roles. → RF-26
- **`App.tsx`** — rutas nuevas con las guardas existentes.

### Estilos
`index.css`: tarjetas de turno, estados con color y texto, bloqueos rayados, tabla/lista de pagos; respeta 360 px y modo oscuro si el CSS ya lo maneja. → RF-26

## 3. Documentación
- **README**: tabla de roles ("Disponible en": Pantalla para turnos y pagos), "Límites conocidos" (ventana de corrección y presets en UTC; sin reprogramación desde el panel), sección "Operar el negocio sin pantallas" reducida a comisiones. Test del README actualizado primero. → criterio 4
- **Spec 003**: nota al pie de la RF-19 / RF-20 y de los presets indicando que las pantallas usan rango libre local (D2); sin cambiar su contrato.

## 4. Estrategia de tests (TDD, en este orden)
1. **Backend unit**: `correctAppointment` con actor staff ajeno → 404 sin tocar repos de pagos; staff propio → igual que hoy; owner → igual que hoy; bloqueo de negocio con staff → 404.
2. **Backend integración**: recorrido (RF-2) — staff B contra un turno de staff A en `GET`, `PATCH`, `cancel`, `cancel-block`, `correct` → 404 y el turno y sus pagos intactos.
3. **Frontend dominio**: `day` (TZ UTC y Santiago, cambio de hora), `appointmentActions` (matriz estado × rol × ventana), `appointmentForm`, `availabilityCheck`, `payments`, `errors`.
4. **Frontend componentes** (servicios mockeados, como en las specs 005 y 009): `AppointmentCard`, `AppointmentForm`, `ClientPicker`, `BlockForm`, `PeriodPicker`, `SummaryCards`, `PaymentsTable`.
5. **Frontend páginas**: `DashboardPage` (crear, cancelar, bloquear, corregir, filtros, estado vacío, errores) y `PaymentsPage` (owner con desglose, staff sin desglose, cambio de período, `hasMore`, sin comisión).
6. **Rutas**: `App.routes.test.tsx` con `/owner/pagos` y `/staff/pagos` y sus guardas.
7. **Smoke de CI**: crea un turno pasado por API, lo corrige a `no_llego` con un staff ajeno (404) y con el owner (200), y verifica que `GET /payments/summary` cambia.

## 5. Riesgos y decisiones de implementación
- **R1 — Días locales y servidor**: la agenda ya pide el día local (`toDateRange`) y la API filtra por instante; no hay conversión nueva. El riesgo está en los presets de la API (D2), que las pantallas evitan.
- **R2 — Doble definición de "ventana de corrección"**: el navegador la replica (`isCorrectable`) y la API es la autoridad; si difieren, la API responde 422 y la pantalla lo explica (RF-17). Se comparten los casos de borde entre ambos tests para evitar deriva.
- **R3 — Turno creado `completado`**: un turno cargado en el pasado dispara un pago en la misma transacción (spec 001 RF-9); la pantalla lo informa para que no sorprenda en Pagos.
- **R4 — Clientes**: `GET /clients` devuelve todos los de la cuenta sin paginar; se filtra en el navegador. Suficiente para un negocio individual; si crece, se pide una spec de búsqueda en servidor.
- **R5 — Concurrencia**: dos usuarios editando la misma agenda; tras cada acción la fila se reemplaza por la respuesta de la API y los conflictos se resuelven con los códigos 409/422 ya existentes.
