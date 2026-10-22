# Plan 005 — Reserva pública y autogestión del turno

Deriva de `spec.md` (36 RF). Sin código: módulos, decisiones y estrategia de
tests. Cada parte indica los RF que cubre. Sin migraciones: el modelo de datos
no cambia.

## 1. Backend

### `domain/` (puro, sin I/O)

- **`domain/appointmentScheduling.js`** (modificar) — añadir `assertScheduledAtNotPast(value, now)`:
  - `value` no es un instante ISO válido (`new Date(value)` es `NaN`, o no es string/Date) → 400 `invalid_scheduled_at`. → RF-10b
  - inicio `<= now` → 422 `appointment_in_past`. → RF-10
  - Devuelve el `Date` ya parseado. Las firmas existentes no cambian.
- **`domain/uuid.js`** (nuevo) — `isUuid(value)`: regex de UUID (versión y variante indistintas, como las que emite `gen_random_uuid()`). Lo usan RF-3 y RF-7. → RF-3, RF-7

### `application/`

- **`application/getPublicAccount.js`** (nuevo) — RF-1..RF-4
  `!isUuid(id)` → 404; `repos.accounts.findById` → `undefined` → 404. Servicios: `repos.services.findAll(db, id, { active: true })`, **proyectados** a `{ id, name, duration_minutes, price }` y ordenados por nombre en el caso de uso (no se altera el orden de `findAll`, que usa `GET /services`). Profesionales: `repos.users.findManyByAccount(db, id, { status: 'activo' })` (ya filtra `role = 'staff'` y ordena por nombre), proyectados a `{ id, name }`. La proyección explícita —lista blanca, no `omit`— es lo que garantiza RF-2. Devuelve `{ id, business_name, services, professionals }`.
- **`application/getPublicAppointment.js`** (nuevo) — RF-5, RF-6
  Corre después de `publicAuth` (el token ya se validó). `repos.appointments.findById` → `findVisible` (reuso: trae `service` y `assignedUser` con proyección resumida) → `repos.accounts.findById` para `business_name`. Devuelve `{ id, status, scheduled_at, scheduled_until, service, professional, business_name }`; **no** se construye a partir de `client`, que `findVisible` también trae (RF-6: lista blanca).
- **`application/listAvailableSlots.js`** (nuevo, extrae la lógica de `routes/availability.js`) — RF-9
  Misma lógica de recorrido de ventanas que hoy vive en la ruta (comportamiento idéntico), con tres cambios: recibe `now` (por defecto `new Date()`), descarta slots con `starts_at <= now`, y obtiene los turnos ocupados vía `repos.appointments.findTakenSlots`. Motivo de extraer: hoy es lógica sin tests dentro de un handler; RF-9 la modifica y necesita test unitario con `now` fijo (spec 001 D-P7, mismo criterio).
- **`application/createAppointment.js`** (modificar) — RF-10, RF-10b
  Recibe `now = new Date()` y llama `assertScheduledAtNotPast(scheduledAt, now)` **antes** de cualquier lectura o escritura. Es seguro aplicarlo acá: este caso de uso es exclusivo del booking público y de la reprogramación; el panel usa `createAppointmentFromPanel` (spec 001), que conserva el permiso de turnos pasados (D4).
- **`application/rescheduleAppointment.js`** (modificar, mínimo) — RF-10
  Valida el nuevo inicio **antes** de cancelar el turno viejo (`assertScheduledAtNotPast`), para no depender del rollback de la transacción para un caso evitable; sigue pasando por `createAppointment`, que repite la guarda (defensa en profundidad barata). Acepta `now` para tests.

### `infrastructure/`

- **`db/repositories/accounts.js`** (nuevo, exportado como `accounts` en `repositories/index.js`) — `findById(db, id)`. Hasta ahora las rutas usaban la tabla `accounts` directo.
- **`db/repositories/appointments.js`** (modificar) — `findTakenSlots(db, { accountId, from, to })`: la consulta que hoy está en `routes/availability.js` (`status != 'cancelado'`, solapa con `[from, to)`, columnas mínimas), movida tal cual.
- **`http/middleware/errorHandler.js`** (nuevo) — el handler de errores que hoy está inline en `app.js`, extraído para reutilizarlo en los tests HTTP. `app.js` lo importa; comportamiento idéntico.
- **`http/middleware/publicAuth.js`** (modificar) — `!isUuid(req.params.id)` o token no-string → 401 `unauthorized` antes de tocar la base (hoy un id no UUID llega a Postgres y da 500). → RF-7
- **`http/routes/public.js`** (modificar) — dos limitadores:
  - `strictLimiter` (la config actual, 20/15 min) aplicado **por ruta** a `POST /bookings`, `PATCH .../cancel`, `PATCH .../reschedule` y `POST /staff-invitations/activate`. Hoy es `router.use(...)`: se reemplaza para que no cubra las lecturas.
  - `readLimiter` (120/15 min) en las dos rutas nuevas. → RF-8
  - Nuevas: `GET /accounts/:id` (sin auth) y `GET /appointments/:id` (`publicAuth`), delegando en los casos de uso.
  - `POST /bookings` y `PATCH .../reschedule` no cambian de forma; heredan RF-10 de los casos de uso.
- **`http/routes/availability.js`** (modificar) — pasa a delegar en `listAvailableSlots`. Contrato idéntico salvo RF-9.

### `docs`

- **`docs/diseno-gestor-turnos.md` §4** — tabla de rutas públicas (`/public/accounts/:id`, `/public/appointments/:id`), la nota de los dos limitadores y un resumen del mapa de rutas del frontend.

## 2. Frontend

### Infraestructura de tests (RF de calidad; principio 9)

- `devDependencies`: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`. Se verifica contra la documentación vigente (Context7) la compatibilidad con la versión de Vite instalada antes de fijar versiones.
- `vite.config.ts`: bloque `test` (`environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, `globals: false`). `package.json`: script `"test": "vitest run"`. Los tests viven junto al código (`*.test.ts(x)`), que `tsc` ya cubre por `include: ["src"]`.

### Capas (misma separación que el backend, sobre los directorios existentes)

- **`domain/`** (puro, sin React ni `fetch`) — la lógica que se prueba primero:
  - `domain/publicTypes.ts`: `PublicAccount`, `PublicAppointment`, `Slot`, `BookingResult`.
  - `domain/slots.ts`: `dedupeByStart(slots)` (RF-16), `groupByDay(slots, days, from)` → lista de `{ day, slots }` con días sin horarios marcados (RF-15), `rangeFor(from, days)` → `{ date_from, date_to }` (RF-15).
  - `domain/booking.ts`: `validateClient({ name, email, phone })` → mapa de errores por campo (RF-18, regex de teléfono idéntica a la del backend); `buildBookingPayload(...)` (RF-16: omite `employee_id` si es "Cualquiera"); `manageLink(origin, id, token)` (RF-20, RF-28).
  - `domain/errors.ts`: `publicErrorMessage(code)` — único lugar que traduce códigos de la API a español (RF-33), con mensaje genérico para códigos desconocidos.
- **`services/api.ts`** (modificar) — `request` recibe una opción `{ auth: boolean }`. Se exporta `apiPublic` (`get/post/patch`) con `auth: false`: **no** adjunta `Authorization` y **no** emite `auth:logout` ante 401 (RF-31). `api` conserva su comportamiento. `ApiError` también guarda el código HTTP (ya lo tiene).
- **`services/public.ts`** (nuevo) — `publicService`: `getAccount`, `getSlots`, `book`, `getAppointment(id, token)`, `cancel(id, token)`, `reschedule(id, token, body)`; todo sobre `apiPublic`. El token se pasa por argumento y viaja solo en la query de cada llamada (RF-30).
- **`services/appointments.ts`** (modificar) — se elimina `create`, que apunta a `POST /appointments` (hoy solo del panel); el booking público pasa a `publicService.book`. Nadie más lo usa.
- **`components/`** (nuevo directorio, ya previsto en el diseño §5):
  - `SlotPicker.tsx`: tira de días + horarios del día elegido (RF-15, RF-17). La usan reserva y reprogramación (RF-27), por eso es componente aparte.
  - `ManageLinkBox.tsx`: muestra el enlace, botón "Copiar" con degradado si no hay `clipboard`, y el aviso de guardarlo (RF-20, RF-28).
- **`pages/BookingPage.tsx`** (nuevo) — asistente con estado local (`step`, selecciones, datos del cliente). Carga `getAccount` al montar; los pasos son secciones renderizadas condicionalmente; "volver" cambia `step` sin borrar selecciones (RF-13). Maneja 409 → recarga de slots (RF-21), botón deshabilitado en curso (RF-19).
- **`pages/ManagePage.tsx`** (nuevo) — lee `id` (ruta) y `token` (query), `getAppointment`; ramifica por error (`token_expired` / `unauthorized`, RF-24) y por estado (RF-25); acciones cancelar y reprogramar con confirmación (RF-26..RF-29).
- **`App.tsx`** (modificar) — rutas `/reservar/:accountId` y `/turno/:id` fuera de `PublicRoute`/`OwnerRoute`/`StaffRoute` (RF-32), antes del comodín `*`.
- **`index.css`** (modificar) — bloque nuevo `/* ── Reserva pública ── */` con clases `pub-*`, mobile-first, reutilizando las variables de color existentes y su modo oscuro (RF-34).
- **`index.html`** — `lang="es"`. → RF-35

## 3. Decisiones (con alternativa descartada)

- **D-P1. `listAvailableSlots` como caso de uso, extrayendo la lógica de la ruta.** RF-9 la modifica y hoy no tiene tests. *Descartado:* filtrar `starts_at > now` en el handler — queda sin test unitario y dependiendo del reloj real.
- **D-P2. La regla "no pasado" va en `createAppointment` y no en la ruta.** Es una regla de negocio (principio 3) y el caso de uso ya es exclusivo del flujo público. *Descartado:* parámetro `allowPast` en `createAppointment` — la spec 001 ya separó el caso de uso del panel justamente para no tener banderas.
- **D-P3. Proyección por lista blanca en los dos casos de uso públicos.** RF-2 y RF-6 son garantías de no filtrado; construir la respuesta campo a campo hace que agregar una columna sensible a una tabla no la exponga por accidente. *Descartado:* devolver la fila y borrar campos — falla hacia el lado inseguro.
- **D-P4. Dos limitadores aplicados por ruta, no `router.use`.** `router.use` cubriría también las lecturas nuevas y las haría compartir el cupo estricto. *Descartado:* un limitador único más alto — debilitaría la protección contra fuerza bruta sobre tokens, que es su función en cancelar/reprogramar.
- **D-P5. `apiPublic` en el mismo módulo que `api`, con una opción en el núcleo `request`.** Evita duplicar el manejo de errores y de 204. *Descartado:* un segundo módulo de fetch — dos implementaciones que pueden divergir.
- **D-P6. Estado del asistente con `useState` local, sin librería de formularios ni de estado.** Un solo flujo, un solo componente (principio 11, YAGNI). *Descartado:* React Hook Form / reducer externo — dependencias sin necesidad real; la validación es una función pura de `domain/`.
- **D-P7. Tests HTTP del router público con un servidor Express efímero** (`app.listen(0)` + `fetch`), sin `supertest`. `app.js` arranca el servidor y el cron al importarse, así que se monta solo `routes/public.js` con el `errorHandler` extraído. *Descartado:* sumar `supertest` — una dependencia más cuando `fetch` de Node alcanza.
- **D-P8. Rango de slots = hoy 00:00 local + 14 días, una sola solicitud.** El backend recorre días enteros; pedir 14 días en una llamada evita 14 viajes y permite deshabilitar días vacíos (RF-15). *Descartado:* una solicitud por día al elegirlo — más lenta y no permite saber qué días están vacíos.

## 4. Estrategia de tests (TDD, principio 9)

Orden: primero los casos **no obvios**; después el camino feliz.

### Backend — unit (`tests/domain/`, `tests/application/`, repos falsos)
- `appointmentScheduling.test.js` (ampliar): `assertScheduledAtNotPast` con inicio pasado / igual a `now` → 422; futuro → ok y devuelve `Date`; `'x'`, `null`, `undefined`, número → 400. — RF-10, RF-10b
- `uuid.test.js` (nuevo): UUID válido, mayúsculas, `''`, `'abc'`, con espacios, `null`. — RF-3, RF-7
- `getPublicAccount.test.js`: id no UUID → 404 sin tocar repos; cuenta inexistente → 404; la respuesta **solo** contiene las claves de la lista blanca aunque los repos devuelvan columnas extra (`email`, `commission_rate`, `password_hash`); servicios ordenados por nombre; listas vacías → 200. — RF-1..RF-4
- `getPublicAppointment.test.js`: la respuesta no contiene `client` ni `notes` aunque el repo los devuelva. — RF-5, RF-6
- `listAvailableSlots.test.js` (nuevo, `now` fijo): descarta slots pasados incluido el del instante exacto; mantiene los futuros; respeta turnos ocupados y bloqueos de negocio; ventana multi-tramo; mismo resultado que antes de la extracción para un caso sin pasado (regresión). — RF-9
- `createAppointment.test.js` / `rescheduleAppointment.test.js` (ajustar): sus fechas fijas de sept/oct 2026 ya son pasado, se pasa `now` anterior a ellas; casos nuevos: inicio pasado → 422 y **ningún** repo de escritura llamado; en reprogramación el turno viejo **no** se cancela. — RF-10

### Backend — integración (`tests/integration/publicApi.test.js`, Postgres real + servidor efímero)
1. `GET /public/accounts/:id` con datos reales: no aparece un servicio inactivo, un staff `pendiente`/`inactivo` ni el owner; el cuerpo no contiene `@`, `commission` ni `password`. — RF-1, RF-2
2. `GET /public/accounts/no-es-uuid` → 404 (no 500). — RF-3
3. `GET /public/appointments/:id` con token correcto → 200 sin datos del cliente; token de otro turno → 401; vencido → 401 `token_expired`; id no UUID → 401. — RF-5..RF-7
4. Reserva pública con inicio pasado → 422 y sin fila; con `scheduled_at: 'x'` → 400; reprogramar al pasado → 422 y el turno original sigue `agendado`. — RF-10, RF-10b
5. El panel (`createAppointmentFromPanel`) sigue creando un turno pasado como `completado`. — D4, spec 001 RF-9
6. `GET /availability/:id` no devuelve horarios de hoy ya transcurridos. — RF-9
7. Limitadores: 25 lecturas seguidas → todas 200; 21ª escritura con token inválido → 429. — RF-8

### Frontend — unit (`vitest`, sin DOM)
- `slots.test.ts`: `dedupeByStart` con dos profesionales en el mismo horario → uno solo; `groupByDay` marca días vacíos y agrupa por día **local**; `rangeFor`. — RF-15, RF-16
- `booking.test.ts`: `validateClient` (sin nombre, sin email ni teléfono, `+54911…` válido, `1155…` sin `+`, email sin `@`); `buildBookingPayload` sin `employee_id` para "Cualquiera" y con él para un profesional; `manageLink`. — RF-16, RF-18, RF-20
- `errors.test.ts`: código conocido → mensaje en español; desconocido → genérico, nunca el código. — RF-33
- `api.test.ts` (con `fetch` simulado): `apiPublic` no manda `Authorization` aunque haya `token` en `localStorage`; un 401 **no** dispara `auth:logout`; `api` (panel) sigue haciendo ambas cosas. — RF-31

### Frontend — componentes/páginas (Testing Library, `publicService` simulado con `vi.mock`)
- `BookingPage.test.tsx`: 404 → "Negocio no encontrado"; sin servicios → aviso (RF-11, RF-12); recorrido completo hasta el enlace de gestión; "Cualquiera" no envía `employee_id` (RF-16); un 409 al confirmar vuelve al paso de horarios con los datos intactos (RF-21); doble clic en confirmar → una sola llamada a `book` (RF-19); validación bloquea el envío (RF-18).
- `ManagePage.test.tsx`: `token_expired` y `unauthorized` (RF-24); turno `cancelado` sin acciones (RF-25); cancelar exige confirmación (RF-26); reprogramar con 409 deja el turno original (RF-29); el enlace nuevo reemplaza al viejo (RF-28); `localStorage` no contiene el token tras todo el flujo (RF-30).
- `App.routes.test.tsx`: con sesión de owner iniciada, `/reservar/:id` renderiza la página pública y no redirige (RF-32).

### Gate
Backend: `npm test` y `npm run db:migrate` en verde. Frontend: `npm test`, `npm run lint` y `npm run build` en verde. Todos antes de cada commit.

## 5. Mapa RF → módulo

| RF | Dónde se cubre |
|---|---|
| RF-1, RF-2, RF-4 | `getPublicAccount` (lista blanca) |
| RF-3 | `domain/uuid.js` + `getPublicAccount` |
| RF-5, RF-6 | `getPublicAppointment` (lista blanca) |
| RF-7 | `publicAuth` (guarda UUID) + rutas públicas |
| RF-8 | `readLimiter` / `strictLimiter` por ruta en `public.js` |
| RF-9 | `listAvailableSlots` |
| RF-10, RF-10b | `assertScheduledAtNotPast` en `createAppointment` / `rescheduleAppointment` |
| RF-11, RF-12 | `BookingPage` (carga y estados vacíos) |
| RF-13, RF-14 | `BookingPage` (asistente) |
| RF-15, RF-17 | `domain/slots.ts` + `SlotPicker` |
| RF-16 | `dedupeByStart` + `buildBookingPayload` |
| RF-18 | `validateClient` |
| RF-19, RF-21, RF-22 | `BookingPage` + `publicErrorMessage` |
| RF-20, RF-28 | `ManageLinkBox` + `manageLink` |
| RF-23..RF-27, RF-29 | `ManagePage` + `SlotPicker` |
| RF-30 | `publicService` (token solo por argumento y query) |
| RF-31 | `apiPublic` |
| RF-32 | `App.tsx` |
| RF-33 | `domain/errors.ts` |
| RF-34, RF-35 | `index.css` (`pub-*`), `index.html`, formateo `es-AR` |

## 6. Verificación

- Backend: `npm run db:migrate` limpio y `npm test` verde sobre una DB vacía.
- Frontend: `npm test`, `npm run lint`, `npm run build` verdes.
- Recorrido manual del flujo de "Criterios de finalización" de `spec.md`, con backend (`:3000`) y `vite dev` (el proxy `/api` ya está configurado): datos de prueba creados por la API (owner, staff activo con horario, un servicio), reserva sin sesión, enlace en otra pestaña, reprogramar, cancelar, enlace viejo y turno con plazo vencido.
- Comprobar en el navegador con el panel abierto en otra pestaña que probar la reserva **no** cierra la sesión del owner.

## 7. Archivos tocados (resumen)

- **Backend nuevos:** `domain/uuid.js`, `application/{getPublicAccount,getPublicAppointment,listAvailableSlots}.js`, `infrastructure/db/repositories/accounts.js`, `infrastructure/http/middleware/errorHandler.js`, tests unit e integración.
- **Backend modificados:** `domain/appointmentScheduling.js`, `application/{createAppointment,rescheduleAppointment}.js`, `repositories/{appointments,index}.js`, `middleware/publicAuth.js`, `routes/{public,availability}.js`, `app.js`, `tests/application/{createAppointment,rescheduleAppointment}.test.js`, `docs/diseno-gestor-turnos.md`.
- **Frontend nuevos:** `domain/{publicTypes,slots,booking,errors}.ts`, `services/public.ts`, `components/{SlotPicker,ManageLinkBox}.tsx`, `pages/{BookingPage,ManagePage}.tsx`, `src/test/setup.ts`, tests.
- **Frontend modificados:** `services/{api,appointments}.ts`, `App.tsx`, `index.css`, `index.html`, `vite.config.ts`, `package.json`.
