# Plan 009 — Gestión del negocio en el panel

Deriva de `spec.md` (27 RF). Sin migraciones ni dependencias nuevas. El backend solo cambia lo necesario para cerrar la invitación (RF-21, RF-22); el resto es frontend. Cada parte indica los RF que cubre.

## 1. Backend (cambio mínimo)

### `domain/`
- **`domain/invitation.js`** (nuevo, puro) — `buildInvitationLink(appUrl, token)` → `${appUrl sin barra final}/activar?token=${encodeURIComponent(token)}`. → RF-21, RF-22
- **`domain/publicUser.js`** — ya existe (`7cf9341`). → RF-1

### `application/`
- **`inviteStaff.js`** y **`resendStaffInvitation.js`** (modificar) — reciben `appUrl`, construyen el enlace con `buildInvitationLink`, se lo pasan a `repos.email.sendInvitation({ to, link })` (hoy recibe el token pelado) y lo devuelven como `invitation_link` junto al usuario. Siguen enviando dentro de la transacción (spec 002 RF-15). → RF-21
- Los demás casos de uso no cambian.

### `infrastructure/`
- **`config.js`** (modificar) — `loadConfig` suma `appUrl` (`APP_URL`, default `http://localhost:5173`): debe ser una URL `http(s)` válida; en `production` debe ser `https://`. El mensaje de error nombra la variable y no el valor. → RF-22
- **`http/appUrl.js`** (nuevo) — `getAppUrl()` lee `process.env.APP_URL` con el mismo default; lo usan las rutas `staff` (mismo patrón que `jwt.js`, que lee el entorno en cada llamada). `app.js` ya llama a `loadConfig`, así que una `APP_URL` inválida impide arrancar. → RF-22
- **`integrations/email.js`** (modificar) — el log pasa a `[email] invitación de trabajador → <to>: <link>` con el enlace completo (hoy imprime el token). → RF-22
- **`routes/staff.js`** (modificar) — pasa `appUrl: getAppUrl()` a `inviteStaff` y `resendStaffInvitation`.
- **Configuración**: `.env.example` y `docker-compose.yml` (servicio `backend`) suman `APP_URL=http://localhost:5173`; el README documenta la variable en su tabla de entorno.

## 2. Frontend

Estructura nueva, en el orden en que se prueba (lógica pura primero, como en la spec 005):

### `domain/` (puro, con tests)
- **`domain/schedule.ts`** — modelo del horario: `Window { day_of_week, start_time, end_time }`; `groupByDay(windows)` → siete listas ordenadas (lunes primero: la API usa 0 = domingo, la pantalla muestra lunes→domingo); `flattenSchedule(days)`; `validateSchedule(days)` → errores por fila (`start_not_before_end`, `overlap`), con contiguos válidos; `isDirty(a, b)`. Se prueba con los mismos casos que `tests/domain/availabilityWindows.test.js` (D4). → RF-15..RF-17, RF-19
- **`domain/money.ts`** — `parsePrice('8.000' | '8000')` → string decimal para la API; `formatPrice` ya existe en `format.ts`. → RF-5, RF-6
- **`domain/commission.ts`** — `percentToFraction(' 25 ')` → `0.25`, `fractionToPercent('0.2500')` → `25`; vacío ↔ `null`; rechaza fuera de 0–100. → RF-10, RF-12
- **`domain/invitation.ts`** — `readActivationToken(search)`; `INVITATION_NOTICE`. → RF-11, RF-23, RF-24
- **`domain/errors.ts`** (modificar) — nuevo `managementErrorMessage(code)` con los códigos del panel: `email_taken`, `invalid_commission`, `invalid_field`, `invalid_body`, `missing_fields`, `invalid_window`, `invalid_time_format`, `invalid_day_of_week`, `start_must_be_before_end`, `overlapping_windows`, `invalid_status_transition`, `invalid_password`, `forbidden`, `not_found`, `network_error`, `too_many_requests`, más el genérico. Separado de `publicErrorMessage` porque los textos difieren (hablan al owner, no al cliente). → RF-8

### `services/`
- **`services/services.ts`** — ya existe; se ajusta el tipo de `update` y la respuesta.
- **`services/staff.ts`** (nuevo) — `list(status?)`, `get`, `invite`, `edit`, `resendInvitation`, `deactivate`, `getAvailability(id)`, `replaceAvailability(id, windows)`, `editMe`. El PUT usa `api.put` (agregar `put` a `services/api.ts`). Tipos nuevos en `domain/types.ts`: `StaffMember` (vista de usuario con `status` y `commission_rate`), `StaffStatus`, `InvitationResult`. → RF-9..RF-20
- **`services/public.ts`** (modificar) — `activateAccount(token, password)` por `apiPublic`. → RF-23, RF-25
- **`services/auth.ts`** — se reutiliza `login` tras activar. → RF-23

### `components/`
- **`AppNav.tsx`** — encabezado con enlaces por rol (`NavLink`) y "Salir"; reemplaza el `<header>` actual de `DashboardPage`. → RF-2
- **`ConfirmDialog.tsx`** — confirmación modal accesible (`role="alertdialog"`, foco inicial en "Cancelar", Escape cierra). Se usa en desactivar servicio/trabajador y en "Volver" con cambios sin guardar. → RF-7, RF-14, RF-19
- **`CopyLinkBox.tsx`** — generaliza `ManageLinkBox` (spec 005): muestra el enlace, "Copiar" y un aviso configurable. `ManageLinkBox` pasa a ser un caso de uso del genérico, sin cambiar su comportamiento ni sus tests. → RF-11
- **`ScheduleEditor.tsx`** — controlado: recibe `days`, `errors`, `onChange`; siete filas con tramos agregables/quitables (`<input type="time">`, etiquetas "Lunes · desde"/"hasta"). Sin lógica de validación (vive en `domain/schedule.ts`). → RF-15..RF-17
- **`ErrorNote.tsx`** — `role="alert"` con el mensaje de `managementErrorMessage`. → RF-8

### `pages/`
- **`ServicesPage.tsx`** (`/owner/servicios`) — lista activos/inactivos, formulario "Nuevo servicio", edición en línea (nombre, duración), cambio de precio, desactivar con confirmación. → RF-4..RF-8
- **`StaffPage.tsx`** (`/owner/equipo`) — tabla/tarjetas con filtro de estado, formulario de invitación, edición en línea, "Reenviar invitación", "Desactivar", enlace a "Horario" para rol `staff`; tras invitar/reenviar muestra `CopyLinkBox` con `invitation_link`. → RF-9..RF-14
- **`SchedulePage.tsx`** (`/owner/equipo/:id/horario` y `/staff/horario`) — resuelve el id (`useParams` o el del usuario), carga con `getAvailability`, edita con `ScheduleEditor`, guarda con `replaceAvailability`; 404 → "Trabajador no encontrado"; en `/staff/horario` agrega el bloque "Mi perfil" (nombre y contraseña, `PATCH /me`). Aviso de cambios sin guardar con `beforeunload` y `ConfirmDialog` en "Volver". → RF-15..RF-20
- **`ActivatePage.tsx`** (`/activar`) — lee `token` de la query, formulario de contraseña con repetición, llama a `activateAccount`, luego `login` y navega a `/staff/horario`; 410 o token ausente → mensaje sin formulario. Ruta pública fuera de `PublicRoute`. → RF-23..RF-25
- **`DashboardPage.tsx`** (modificar) — usa `AppNav`; la hora pasa a 24 h (`HH:mm`). → RF-2, RF-26

### `App.tsx`
Rutas nuevas: `OwnerRoute` → `/owner/servicios`, `/owner/equipo`, `/owner/equipo/:id/horario`; `StaffRoute` → `/staff/horario`; pública → `/activar`. `roleHome` no cambia (la agenda sigue siendo la entrada). → RF-3, RF-25

### Estilos
`index.css` suma las clases de las pantallas nuevas con las variables existentes; mínimo ancho 360 px, sin scroll horizontal. → RF-27

## 3. Documentación
- **README**: la tabla de roles pasa de "Solo API" a "Pantalla" para servicios, equipo y horarios; la sección "Operar el negocio sin pantallas" se reduce a lo que sigue siendo solo API (turnos del panel y pagos); se documenta `APP_URL`. `tests/docs/readme.test.js` se actualiza con esas afirmaciones. → criterio 3
- **Constitución**: sin enmiendas.

## 4. Estrategia de tests (TDD, en este orden)
1. **Backend unit**: `buildInvitationLink` (barra final, caracteres especiales, `encodeURIComponent`); `loadConfig` con `APP_URL` (default, inválida, `http://` en producción); `inviteStaff`/`resendStaffInvitation` con `appUrl` falso devuelven `invitation_link` y llaman a `email.sendInvitation` con el enlace.
2. **Backend integración**: `POST /staff` y `PATCH /:id/resend-invitation` devuelven `invitation_link` al owner, ningún otro endpoint lo incluye y el enlace activa la cuenta de punta a punta (`POST /public/staff-invitations/activate` con el token extraído del enlace); `userResponses.test.js` sigue verde.
3. **Frontend dominio**: `schedule`, `commission`, `money`, `invitation`, `errors`.
4. **Frontend componentes** (Testing Library, servicios mockeados con `vi.mock`, como `ManagePage.test.tsx`): `ScheduleEditor`, `ConfirmDialog`, `CopyLinkBox`, `AppNav`.
5. **Frontend páginas**: `ServicesPage`, `StaffPage`, `SchedulePage` (owner y staff), `ActivatePage` (éxito, 410, sin token), `App.routes.test.tsx` (guardas por rol y `/activar` pública con sesión abierta).
6. **Smoke de CI** (spec 006): un paso nuevo que crea un servicio e invita a un trabajador por API y verifica que `invitation_link` empiece con `APP_URL` y que `GET /activar?token=…` sirva la SPA (nginx `try_files`).

## 5. Riesgos y decisiones de implementación
- **R1 — Conversión de días**: la API usa `0 = domingo`; la pantalla muestra lunes primero. La conversión vive solo en `domain/schedule.ts` y tiene tests dedicados.
- **R2 — Precios con puntos de miles**: el campo acepta `8000` o `8.000`; `parsePrice` rechaza `8,50` (CLP sin decimales) con un mensaje claro en vez de adivinar.
- **R3 — Token en la URL de `/activar`**: igual que el enlace de gestión del cliente, la página aplica `Referrer-Policy: no-referrer` (ya servido por nginx, spec 008) y tras usar el token reemplaza la URL (`navigate(..., { replace: true })`) para que no quede en el historial.
- **R4 — Cambios sin guardar** en `SchedulePage`: `beforeunload` para cierre/recarga y `ConfirmDialog` en su botón "Volver". `useBlocker` queda descartado porque requiere un data router y la app usa `BrowserRouter` (D6).
- **R5 — Reactivación silenciosa** (spec 002 RF-7): invitar el email de un inactivo devuelve 200 con `action: 'reactivate'`; la pantalla lo comunica ("Reactivamos a …") en lugar de mostrar "creado".
