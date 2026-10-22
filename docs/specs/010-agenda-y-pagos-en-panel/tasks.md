# Tasks 010 — Agenda operativa y pagos en el panel

Deriva de `plan.md`. Tareas de <30 min, en orden de dependencia. TDD: donde dice "test que falla", ese test se escribe y se ve fallar antes de implementar. Sin migraciones ni dependencias nuevas.

**Rama:** `spec/010-agenda-y-pagos-en-panel` (creada sobre la 009; rebasar sobre `main` cuando la 009 se integre).

## Fase 0 — Línea base

- [ ] **T00 · Línea base** — todas
  Con DB limpia: `npm test` del backend en `TZ=UTC` y `America/Santiago`; `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` del frontend. Reproducir el hueco a mano: staff B hace `PATCH /appointments/<turno de A>/correct` → hoy 200.
  **Hecho cuando:** todo en verde, conteos anotados y el hueco reproducido.

## Fase 1 — Backend: alcance por rol

- [ ] **T01 · `correctAppointment` respeta el alcance** — RF-1
  Tests que fallan en `tests/application/correctAppointment.test.js`: staff ajeno → 404 y ningún repo de pagos llamado; bloqueo de negocio con staff → 404; staff propio y owner → comportamiento actual. Luego `actor` en el caso de uso y la ruta.
  **Hecho cuando:** pasan y la 404 ocurre antes de `assertTransition` (un turno ajeno `agendado` responde 404, no 422).

- [ ] **T02 · Recorrido de rutas de turnos** — RF-2
  Test de integración que falla (`tests/integration/appointmentScope.test.js`): staff B contra un turno de A en `GET /:id`, `PATCH /:id`, `cancel`, `cancel-block` y `correct` → 404 y turno y pagos intactos; owner → alcance completo.
  **Hecho cuando:** pasa; quitar el chequeo de `correct` lo hace fallar (se comprueba una vez).

## Fase 2 — Frontend: lógica pura

- [ ] **T03 · `domain/day.ts`** — RF-3, RF-20
  Tests que fallan (TZ UTC y America/Santiago, día con cambio de hora): `localDayRange`, `localPeriod('hoy' | 'esta_semana' | 'este_mes')`, rango libre. Extraer `toDateRange` de `DashboardPage`.
  **Hecho cuando:** pasan y `DashboardPage` usa la función extraída sin cambiar de comportamiento.

- [ ] **T04 · `domain/appointmentActions.ts`** — RF-13, RF-15, RF-17, RF-19
  Tests que fallan: matriz estado × rol × ventana; `isCorrectable` con los casos de borde de `appointmentScheduling.test.js` (23:59:59.999 UTC del día siguiente vigente, +1 ms vencida).
  **Hecho cuando:** pasan.

- [ ] **T05 · `appointmentForm`, `availabilityCheck`** — RF-7, RF-8, RF-11, RF-12, RF-16
  Tests que fallan: cuerpo con `client_id` xor `client`; sin `employee_id` para staff o "automático"; `scheduled_at` ISO desde hora local; `validateBlock`; `clientMatches` sin tildes ni mayúsculas; `isWithinSchedule` (dentro, fuera, cruce de tramos, día sin horario).
  **Hecho cuando:** pasan.

- [ ] **T06 · `domain/payments.ts` y errores** — RF-10, RF-21..RF-24
  Tests que fallan: `paymentRow` con y sin comisión; `summaryCards` por rol (staff sin total del negocio); mensajes nuevos de `managementErrorMessage` con tuteo y sin voseo.
  **Hecho cuando:** pasan.

## Fase 3 — Frontend: servicios y componentes

- [ ] **T07 · Servicios HTTP y tipos** — RF-7..RF-23
  Tests que fallan: rutas, métodos y cuerpos de `appointments.create/block/cancel/cancelBlock/correct/edit`, `clients.list`, `payments.summary/list` (query armada con `date_from`/`date_to` y `employee_id`).
  **Hecho cuando:** pasan.

- [ ] **T08 · `AppointmentCard`** — RF-3, RF-13..RF-19
  Tests que fallan: muestra hora 24 h, cliente o "Bloqueo", estado en texto, profesional solo para owner, y exactamente los botones de `availableActions`.
  **Hecho cuando:** pasan.

- [ ] **T09 · `ClientPicker`** — RF-8
  Tests que fallan: filtra mientras se escribe, selecciona uno existente, alterna a "Cliente nuevo" y valida nombre + email o teléfono.
  **Hecho cuando:** pasan.

- [ ] **T10 · `AppointmentForm` y `BlockForm`** — RF-7..RF-12, RF-14, RF-16, RF-19
  Tests que fallan: valores por defecto (día mostrado, profesional automático), staff sin selector de profesional, envío con el cuerpo esperado, error de API visible con lo escrito conservado, advertencia fuera de horario sin bloquear, bloqueo con fin ≤ inicio rechazado localmente.
  **Hecho cuando:** pasan.

- [ ] **T11 · `PeriodPicker`, `SummaryCards`, `PaymentsTable`** — RF-20..RF-24, RF-26
  Tests que fallan: presets emiten el rango local; rango libre inválido (`desde > hasta`) se marca; tarjetas por rol; tabla con "Sin comisión definida"; etiquetas accesibles.
  **Hecho cuando:** pasan.

## Fase 4 — Frontend: páginas y rutas

- [ ] **T12 · `DashboardPage` operativa** — RF-3..RF-6, RF-9, RF-13..RF-19
  Tests que fallan: lista y vacío con "Nuevo turno"; crear agrega la fila y informa si quedó `completado`; cancelar con confirmación; bloquear y cancelar bloqueo; corregir con aviso del pago (RF-18) y fuera de ventana sin botón; `correction_window_expired` explicado; filtro por profesional (owner); aviso de 500.
  **Hecho cuando:** pasan.

- [ ] **T13 · `PaymentsPage`** — RF-20..RF-25
  Tests que fallan: carga con "Este mes" y rango local; cambio de período recarga; owner con desglose y filtro, staff sin desglose; `hasMore`; error de API mostrado; sin ningún control de escritura.
  **Hecho cuando:** pasan.

- [ ] **T14 · Rutas, navegación y estilos** — RF-26
  `App.routes.test.tsx`: `/owner/pagos` y `/staff/pagos` con sus guardas; `AppNav` suma "Pagos". Estilos y revisión manual a 360 px de agenda, formularios y pagos.
  **Hecho cuando:** pasan, `build` ok y la revisión queda anotada.

## Fase 5 — Cierre

- [ ] **T15 · README y spec 003** — RF-27, criterio 4
  Ajustar primero `tests/docs/readme.test.js` (falla) y luego el README (roles, límites, sección sin pantallas); notas al pie en la spec 003 (D2).
  **Hecho cuando:** el test del README pasa.

- [ ] **T16 · Smoke de CI** — plan §4.7
  Pasos nuevos en el job `smoke`: turno pasado por API, corrección con staff ajeno (404) y con el owner (200), resumen que cambia.
  **Hecho cuando:** el workflow pasa en la rama.

- [ ] **T17 · Verificación final y recorrido manual** — criterios 1 y 2
  Suite completa en ambas zonas horarias y el recorrido del criterio 2 con la demo sembrada (`docker compose up --build`).
  **Hecho cuando:** todo en verde, el recorrido funciona de punta a punta y los hallazgos se anotan como deuda o corrección.
