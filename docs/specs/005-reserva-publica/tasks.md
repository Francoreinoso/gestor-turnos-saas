# Tasks 005 — Reserva pública y autogestión del turno

Deriva de `plan.md`. Tareas de <30 min, en orden de dependencia. Cada una con
sus RF y una condición verificable. TDD: donde dice "test que falla", ese
test se escribe y se ve fallar antes de implementar. Backend en `backend/`,
frontend en `frontend/`. Sin migraciones.

## Fase 0 — Línea base

- [x] **T00 · Rama y línea base verde** — todas
  La rama `spec/005-reserva-publica` ya existe (desde la spec 004). Con una DB limpia: `npm run db:migrate` y `npm test` en `backend/` (265 tests); `npm run build` y `npm run lint` en `frontend/`.
  **Hecho cuando:** los cuatro comandos salen con código 0 y se anota el conteo inicial de tests.

## Fase 1 — Backend: dominio (puro)

- [x] **T01 · `domain/uuid.js`** — RF-3, RF-7
  Test que falla en `tests/domain/uuid.test.js`, luego `isUuid`.
  **Hecho cuando:** el test cubre UUID válido, en mayúsculas, `''`, `'abc'`, con espacios, `null` y número (solo los dos primeros son `true`).

- [x] **T02 · `assertScheduledAtNotPast`** — RF-10, RF-10b
  Test que falla en `tests/domain/appointmentScheduling.test.js`, luego la función en `domain/appointmentScheduling.js`.
  **Hecho cuando:** el test cubre inicio pasado e igual a `now` → 422 `appointment_in_past`; futuro → devuelve el `Date`; `'x'`, `null`, `undefined`, número → 400 `invalid_scheduled_at`.

## Fase 2 — Backend: repositorios

- [x] **T03 · `accountRepo` y `appointmentRepo.findTakenSlots`** — RF-1, RF-9
  Crear `repositories/accounts.js` (`findById`) y exportarlo en `index.js`; mover a `findTakenSlots(db, { accountId, from, to })` la consulta de turnos ocupados que hoy está en `routes/availability.js`.
  **Hecho cuando:** un test de integración corto confirma que `findById` devuelve la cuenta (y `undefined` para otra), y que `findTakenSlots` omite `cancelado` y respeta el rango.

## Fase 3 — Backend: casos de uso (repos falsos, test primero)

- [x] **T04 · `getPublicAccount`** — RF-1..RF-4
  Test que falla en `tests/application/getPublicAccount.test.js`, luego el caso de uso.
  **Hecho cuando:** el test cubre: id no UUID → 404 sin llamar a ningún repo; cuenta inexistente → 404; los repos devuelven columnas extra (`email`, `commission_rate`, `password_hash`) y la respuesta contiene **solo** las claves de la lista blanca; servicios ordenados por nombre; sin servicios o sin profesionales → 200 con listas vacías.

- [x] **T05 · `getPublicAppointment`** — RF-5, RF-6
  Test que falla en `tests/application/getPublicAppointment.test.js`, luego el caso de uso.
  **Hecho cuando:** con un repo que devuelve `client` y `notes`, la respuesta no los contiene y trae `service`, `professional` y `business_name`.

- [x] **T06 · `listAvailableSlots` — extracción sin cambios de comportamiento** — RF-9 (preparación)
  Test que falla en `tests/application/listAvailableSlots.test.js` con `now` muy anterior a las fechas (para aislar la extracción): ventana multi-tramo, turno ocupado, bloqueo de negocio (`assigned_user_id = null`). Luego mover la lógica de `routes/availability.js` al caso de uso, usando `findTakenSlots`.
  **Hecho cuando:** el test pasa y la ruta ya delega en el caso de uso (los tests existentes siguen verdes).

- [x] **T07 · `listAvailableSlots` — sin horarios pasados** — RF-9
  Test que falla: con `now` en medio de una ventana, no se devuelven slots con inicio `<=` `now` (incluido el de inicio exacto) y sí los posteriores; luego el filtro.
  **Hecho cuando:** el test pasa y T06 sigue verde.

- [x] **T08 · `createAppointment` / `rescheduleAppointment` rechazan el pasado** — RF-10, RF-10b
  Primero ajustar los tests existentes de `createAppointment.test.js` y `rescheduleAppointment.test.js` para que pasen `now` anterior a sus fechas fijas (que ya son pasado) y confirmar que siguen verdes. Luego test que falla: inicio pasado → 422 y **ningún** repo de escritura llamado; `scheduledAt` inválido → 400; en reprogramación el turno viejo **no** se cancela. Implementar con `assertScheduledAtNotPast` (`rescheduleAppointment` valida antes de cancelar).
  **Hecho cuando:** los tests existentes y los nuevos pasan.

## Fase 4 — Backend: HTTP

- [x] **T09 · Extraer `errorHandler` y guarda UUID en `publicAuth`** — RF-7
  Mover el handler inline de `app.js` a `middleware/errorHandler.js` (comportamiento idéntico). En `publicAuth`: `!isUuid(req.params.id)` o token que no es string → 401 `unauthorized` antes de consultar la base.
  **Hecho cuando:** `app.js` importa el handler extraído y el servidor arranca; un test de integración (T12) cubre el 401 por id no UUID.

- [x] **T10 · `public.js`: rutas nuevas y dos limitadores** — RF-1, RF-5, RF-8
  Reemplazar `router.use(rateLimit(...))` por `strictLimiter` aplicado por ruta a `POST /bookings`, `PATCH .../cancel`, `PATCH .../reschedule` y `POST /staff-invitations/activate`; añadir `readLimiter` (120/15 min) y las rutas `GET /accounts/:id` y `GET /appointments/:id` (`publicAuth`).
  **Hecho cuando:** el servidor levanta y un `curl` a `GET /public/accounts/<id>` devuelve 200 con el negocio de prueba.

- [x] **T11 · `routes/availability.js` delega en `listAvailableSlots`** — RF-9
  Si T06 no lo hizo del todo, dejar la ruta como delgada capa HTTP (parseo de query + `wrap`).
  **Hecho cuando:** la ruta no contiene lógica de recorrido de ventanas y `GET /availability/:id` responde igual que antes para fechas futuras.

## Fase 5 — Backend: integración (Postgres real, servidor efímero)

Todos en `tests/integration/publicApi.test.js`. Helper para montar `routes/public.js` (y el `errorHandler`) en `express().listen(0)` y llamar con `fetch`.

- [x] **T12 · Lecturas públicas sin filtrar datos** — RF-1..RF-3, RF-5..RF-7
  Escenarios 1, 2 y 3 del plan: servicio inactivo / staff `pendiente`/`inactivo` / owner ausentes y el cuerpo sin `@`, `commission` ni `password`; id no UUID → 404; consulta de turno con token correcto (sin datos del cliente), de otro turno, vencido e id no UUID.
  **Hecho cuando:** los escenarios pasan.

- [x] **T13 · Nada en el pasado, de punta a punta** — RF-9, RF-10, RF-10b, D4
  Escenarios 4, 5 y 6: reserva pública pasada → 422 y sin fila; `scheduled_at: 'x'` → 400; reprogramar al pasado → 422 y el original sigue `agendado`; `createAppointmentFromPanel` sigue creando un turno pasado `completado`; `GET /availability` sin horarios de hoy ya transcurridos.
  **Hecho cuando:** los escenarios pasan.

- [x] **T14 · Limitadores** — RF-8
  Escenario 7: 25 lecturas seguidas → todas 200; 21 escrituras con token inválido → la 21ª es 429.
  **Hecho cuando:** ambos escenarios pasan.

## Fase 6 — Frontend: infraestructura de tests

- [x] **T15 · Instalar y configurar Vitest** — principio 9 (justificado en spec, Notas de arquitectura)
  Consultar con Context7 la configuración vigente de Vitest para la versión de Vite instalada; añadir las `devDependencies` del plan, el bloque `test` en `vite.config.ts` (jsdom, `setupFiles`), `src/test/setup.ts` (jest-dom) y el script `"test": "vitest run"`.
  **Hecho cuando:** un test trivial de humo pasa con `npm test`, `npm run build` y `npm run lint` siguen verdes y las dependencias nuevas están solo en `devDependencies`.

## Fase 7 — Frontend: dominio puro (test primero)

- [x] **T16 · `domain/slots.ts`** — RF-15, RF-16, RF-17
  Test que falla en `domain/slots.test.ts`, luego `dedupeByStart`, `groupByDay`, `rangeFor` y los tipos de `publicTypes.ts`.
  **Hecho cuando:** el test cubre dos profesionales en el mismo horario → uno solo; agrupación por día **local**; días sin horarios marcados vacíos; `rangeFor` devuelve 14 días desde las 00:00 locales.

- [x] **T17 · `domain/booking.ts`** — RF-16, RF-18, RF-20, RF-28
  Test que falla en `domain/booking.test.ts`, luego `validateClient`, `buildBookingPayload`, `manageLink`.
  **Hecho cuando:** el test cubre: sin nombre; sin email ni teléfono; `+5491155551234` válido; `1155551234` sin `+` inválido; email sin `@`; payload sin `employee_id` para "Cualquiera" y con él para un profesional; `manageLink` arma `/turno/:id?token=…` con el origen dado y escapa el token.

- [x] **T18 · `domain/errors.ts`** — RF-33
  Test que falla en `domain/errors.test.ts`, luego `publicErrorMessage` con los códigos de la API pública (`appointment_overlap`, `no_professional_available`, `appointment_in_past`, `token_expired`, `unauthorized`, `too_many_requests`, `invalid_status_transition`, `not_found`, `missing_fields`, `client_required`, `service_not_found`, `invalid_scheduled_at`).
  **Hecho cuando:** cada código conocido da un mensaje en español y uno desconocido da el genérico, nunca el código crudo.

## Fase 8 — Frontend: servicios

- [x] **T19 · `apiPublic`** — RF-31
  Test que falla en `services/api.test.ts` (con `fetch` simulado y `localStorage` con un `token`): `apiPublic` no manda `Authorization` y un 401 no dispara `auth:logout`; `api` hace ambas cosas. Luego añadir la opción `{ auth }` a `request` y exportar `apiPublic`.
  **Hecho cuando:** los cuatro casos pasan y `LoginPage`/`DashboardPage` siguen funcionando (`npm run build`).

- [x] **T20 · `services/public.ts` y limpieza de `appointments.ts`** — RF-19, RF-30
  Crear `publicService` (`getAccount`, `getSlots`, `book`, `getAppointment`, `cancel`, `reschedule`) sobre `apiPublic`, con el token solo como argumento y query; eliminar `appointmentsService.create`.
  **Hecho cuando:** `npm run build` compila sin referencias al `create` eliminado y un test con `fetch` simulado confirma las URLs y que `getAppointment`/`cancel`/`reschedule` llevan `?token=` y `book` va a `/public/bookings`.

## Fase 9 — Frontend: componentes y páginas (test primero, `publicService` simulado)

- [x] **T21 · `SlotPicker`** — RF-15, RF-17
  Test que falla: renderiza días, deshabilita los vacíos, muestra los horarios del día elegido en `es-AR`, informa cuando no hay ninguno; emite el slot elegido. Luego el componente.
  **Hecho cuando:** el test pasa operando solo con teclado (`user.tab`/`keyboard`).

- [x] **T22 · `ManageLinkBox`** — RF-20, RF-28
  Test que falla: muestra el enlace completo y el aviso de guardarlo; "Copiar" usa `navigator.clipboard`; sin `clipboard` el enlace sigue visible y no lanza. Luego el componente.
  **Hecho cuando:** ambos caminos pasan.

- [x] **T23 · `BookingPage` — carga y estados vacíos** — RF-11, RF-12, RF-13, RF-14
  Test que falla: 404 → "Negocio no encontrado"; sin servicios o sin profesionales → aviso; con datos, muestra servicios con duración y precio y avanza servicio → profesional ("Cualquiera" por defecto). Luego la página (pasos 1–2) con ruta `/reservar/:accountId`.
  **Hecho cuando:** los tres casos pasan.

- [x] **T24 · `BookingPage` — horario, datos y confirmación** — RF-15..RF-20
  Test que falla: recorrido completo hasta el enlace de gestión; "Cualquiera" no envía `employee_id`; un profesional sí; validación bloquea el envío y marca los campos; doble clic en confirmar → una sola llamada a `book`; volver a un paso conserva lo elegido. Luego los pasos 3–5.
  **Hecho cuando:** los cinco casos pasan.

- [x] **T25 · `BookingPage` — errores de la reserva** — RF-21, RF-22
  Test que falla: 409 → mensaje, recarga de slots y vuelta al paso de horarios con los datos intactos; 429, 400 y error de red → mensaje en español y reintento posible sin perder lo cargado. Luego el manejo.
  **Hecho cuando:** los cuatro casos pasan.

- [x] **T26 · `ManagePage` — consulta** — RF-23..RF-25
  Test que falla: muestra servicio, profesional, fecha, hora, negocio y estado en español; `token_expired` → "plazo vencido"; `unauthorized` → "enlace inválido"; estado distinto de `agendado` → sin acciones. Luego la página con ruta `/turno/:id`.
  **Hecho cuando:** los cuatro casos pasan.

- [x] **T27 · `ManagePage` — cancelar y reprogramar** — RF-26..RF-30
  Test que falla: cancelar exige confirmación y luego muestra `cancelado`; reprogramar ofrece slots del mismo servicio y profesional, pide confirmación y muestra el turno nuevo con su **nuevo** enlace; un 409 deja el turno original y recarga slots; tras todo el flujo `localStorage` no contiene el token. Luego las acciones.
  **Hecho cuando:** los cuatro casos pasan.

## Fase 10 — Integración del frontend y cierre

- [x] **T28 · Rutas, estilos y `lang`** — RF-32, RF-34, RF-35
  Test que falla en `App.routes.test.tsx`: con sesión de owner en `localStorage`, `/reservar/:id` y `/turno/:id` renderizan las páginas públicas sin redirigir. Luego registrar las rutas en `App.tsx` antes del comodín, añadir el bloque `pub-*` de `index.css` (mobile-first, variables y modo oscuro existentes) y `lang="es"` en `index.html`.
  **Hecho cuando:** el test pasa y, en el navegador a 360 px, ninguna de las dos páginas tiene scroll horizontal.

- [x] **T29 · Documentación** — impacto fuera de la spec
  Actualizar `docs/diseno-gestor-turnos.md` §4: rutas públicas nuevas, los dos limitadores y el mapa de rutas del frontend.
  **Hecho cuando:** la documentación coincide con `spec.md` y no contradice ningún RF.

- [x] **T30 · Gate final** — todos los RF
  Backend: `npm test` y `npm run db:migrate` sobre DB vacía. Frontend: `npm test`, `npm run lint`, `npm run build`. Recorrido manual de "Criterios de finalización" de `spec.md` con backend y `vite dev`, y verificación con el panel abierto en otra pestaña de que la sesión del owner no se cierra.
  **Hecho cuando:** los cinco comandos salen con código 0 y el recorrido reproduce cada paso, incluidos el enlace viejo (turno cancelado, sin acciones) y el plazo vencido.
