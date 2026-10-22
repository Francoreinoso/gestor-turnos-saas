# Tasks 009 — Gestión del negocio en el panel

Deriva de `plan.md`. Tareas de <30 min, en orden de dependencia, cada una con sus RF y una condición verificable. TDD: donde dice "test que falla", se escribe y se ve fallar antes de implementar. Backend en `backend/`, frontend en `frontend/`. Sin migraciones ni dependencias nuevas.

**Rama:** `spec/009-gestion-negocio-panel` (creada desde `main`).

## Fase 0 — Línea base

- [ ] **T00 · Línea base** — todas
  Con DB limpia: `npm run db:migrate` y `npm test` en `backend/` (TZ UTC y America/Santiago); `npm test`, `npm run lint`, `npm run typecheck` y `npm run build` en `frontend/`. Anotar los conteos.
  **Hecho cuando:** todo en verde (417 backend, 91 frontend al momento de escribir esto) y las 2 advertencias de lint preexistentes anotadas.

## Fase 1 — Backend: invitación con enlace real

- [x] **T01 · `buildInvitationLink`** — RF-21, RF-22
  Test que falla en `tests/domain/invitation.test.js`: con y sin barra final en `appUrl`, token con caracteres especiales (`encodeURIComponent`), `appUrl` con ruta base. Luego `domain/invitation.js`.
  **Hecho cuando:** los casos pasan.

- [x] **T02 · `APP_URL` en `loadConfig`** — RF-22
  Test que falla en `tests/infrastructure/config.test.js`: default `http://localhost:5173`; valor no URL → `ConfigError` que nombra `APP_URL` sin imprimir el valor; `http://` en producción → error; `https://` en producción → ok. Luego `config.js` y `http/appUrl.js` (`getAppUrl`).
  **Hecho cuando:** los casos pasan y los tests de config existentes siguen verdes.

- [x] **T03 · `inviteStaff` y `resendStaffInvitation` devuelven el enlace** — RF-21
  Tests que fallan en los tests de aplicación existentes de ambos casos de uso (con `appUrl` falso): `email.sendInvitation` recibe `link` = enlace completo (no el token pelado) y el resultado trae `invitation_link`. Luego implementar y pasar `appUrl` desde `routes/staff.js`.
  **Hecho cuando:** pasan los unit; la integración de la spec 002 sigue en verde.

- [ ] **T04 · Integración: del enlace a la sesión** — RF-1, RF-21
  Test que falla en `tests/integration/invitationLink.test.js`: `POST /staff` como owner devuelve `invitation_link`; extraer el `token` de la query; `POST /public/staff-invitations/activate` con ese token y una contraseña → 200 sin `password_hash`; login del trabajador → 200. Reenviar invalida el enlace anterior (410) y devuelve uno nuevo. Ningún otro endpoint de `/staff` incluye `invitation_link`; un staff que invoca → 403 sin enlace.
  **Hecho cuando:** pasa de punta a punta.

- [x] **T05 · `emailService` y configuración** — RF-22
  Test que falla (`tests/infrastructure/email.test.js`): `sendInvitation` imprime un log que contiene el enlace completo y no el token suelto. Luego `integrations/email.js`; `.env.example` y `docker-compose.yml` suman `APP_URL`.
  **Hecho cuando:** pasa y `docker compose config` muestra `APP_URL` en `backend`.

## Fase 2 — Frontend: lógica pura

- [x] **T06 · `domain/schedule.ts`** — RF-15..RF-17, RF-19
  Tests que fallan en `schedule.test.ts` (los mismos casos que `availabilityWindows.test.js`): `groupByDay` ordena lunes→domingo y mapea `0 = domingo` al final; `flattenSchedule` es su inversa; `validateSchedule` marca `inicio ≥ fin` y solapes, y acepta tramos contiguos y días vacíos; `isDirty`.
  **Hecho cuando:** pasan.

- [x] **T07 · `money`, `commission`, `invitation`** — RF-5, RF-6, RF-10, RF-12, RF-23, RF-24
  Tests que fallan: `parsePrice('8.000') → '8000'`, `'8000'`, `'8,5'` rechazado, negativo rechazado; `percentToFraction('25') → 0.25`, `''` → `null`, `'101'` rechazado; `fractionToPercent('0.2500') → '25'`; `readActivationToken('?token=abc') → 'abc'`, sin token → `null`.
  **Hecho cuando:** pasan.

- [x] **T08 · `managementErrorMessage`** — RF-8
  Test que falla en `errors.test.ts`: cada código listado en el plan mapea a un mensaje en español con tuteo y los desconocidos al genérico; ningún mensaje contiene voseo (regex de la lista de verbos usada en el commit `dc46a49`).
  **Hecho cuando:** pasa.

## Fase 3 — Frontend: servicios HTTP y componentes

- [x] **T09 · `api.put`, `services/staff.ts`, `public.activateAccount`, tipos** — RF-9..RF-20, RF-23, RF-25
  Tests que fallan en `api.test.ts` (PUT con cuerpo y JWT), `staff.test.ts` (rutas y métodos de cada llamada) y `public.test.ts` (activación sin JWT y sin cerrar sesión ante 401).
  **Hecho cuando:** pasan.

- [x] **T10 · `ConfirmDialog` y `ErrorNote`** — RF-7, RF-8, RF-14, RF-19, RF-27
  Tests que fallan: `alertdialog` con nombre accesible, foco inicial en "Cancelar", Escape cancela, "Confirmar" invoca el callback; `ErrorNote` usa `role="alert"` y el mensaje mapeado.
  **Hecho cuando:** pasan.

- [x] **T11 · `CopyLinkBox` (generaliza `ManageLinkBox`)** — RF-11
  Tests que fallan para `CopyLinkBox` (aviso configurable, copiar al portapapeles, confirmación "Copiado"); los de `ManageLinkBox` no cambian y siguen verdes.
  **Hecho cuando:** pasan ambos.

- [x] **T12 · `ScheduleEditor`** — RF-15..RF-17, RF-27
  Tests que fallan: siete filas con etiquetas, agregar y quitar tramos, cambio de hora llama a `onChange` con el estado nuevo, un error de fila se anuncia (`role="alert"`) junto a su día.
  **Hecho cuando:** pasan.

- [x] **T13 · `AppNav`** — RF-2
  Tests que fallan: owner ve Agenda, Servicios y Equipo; staff ve Agenda y Mi horario; el enlace activo tiene `aria-current="page"`; "Salir" cierra sesión. `DashboardPage` lo usa y muestra la hora en 24 h (RF-26).
  **Hecho cuando:** pasan y `DashboardPage` conserva su comportamiento.

## Fase 4 — Frontend: páginas

- [x] **T14 · `ServicesPage`** — RF-4..RF-8
  Tests que fallan: lista activos e inactivos con precio en CLP; crear agrega a la lista; editar nombre/duración llama a `update`; cambiar precio llama a `changePrice`; desactivar pide confirmación y mueve a inactivos; error de la API se muestra y el formulario conserva lo escrito.
  **Hecho cuando:** pasan.

- [x] **T15 · `StaffPage`** — RF-9..RF-14
  Tests que fallan: lista con estado y filtro; invitar muestra `CopyLinkBox` con `invitation_link`; `email_taken` se muestra; reactivación se comunica (R5); editar con comisión vacía envía `null`; reenviar solo en `pendiente`; desactivar pide confirmación con aviso de turnos; "Horario" solo para `staff`.
  **Hecho cuando:** pasan.

- [x] **T16 · `SchedulePage`** — RF-15..RF-20
  Tests que fallan: carga y agrupa el horario; guardar envía todo el horario con `replaceAvailability`; validación local bloquea el envío; 404 muestra "Trabajador no encontrado"; "Volver" con cambios pide confirmación; como staff carga el propio id y muestra "Mi perfil" (nombre y contraseña ≥ 8); como owner no muestra "Mi perfil".
  **Hecho cuando:** pasan.

- [x] **T17 · `ActivatePage`** — RF-23..RF-25
  Tests que fallan: sin token → mensaje de enlace vencido; contraseña corta o distinta de la repetición no envía; éxito llama a `activateAccount`, luego `login` y navega a `/staff/horario` con `replace`; 410 → mensaje sin formulario; funciona con sesión abierta.
  **Hecho cuando:** pasan.

- [x] **T18 · Rutas y guardas** — RF-3, RF-25
  Tests que fallan en `App.routes.test.tsx`: staff en `/owner/equipo` → `/staff/agenda`; owner en `/staff/horario` → `/owner/agenda`; sin sesión en `/owner/servicios` → `/login`; `/activar` abre con y sin sesión.
  **Hecho cuando:** pasan y `App.tsx` registra las rutas nuevas.

- [ ] **T19 · Estilos y revisión a 360 px** — RF-26, RF-27
  Clases de las pantallas nuevas en `index.css`; revisión manual a 360 px de las cuatro pantallas: sin scroll horizontal, controles con etiqueta, foco visible.
  **Hecho cuando:** `build` ok y la revisión anotada en la PR.

## Fase 5 — Cierre

- [x] **T20 · README y su test** — criterio 3
  Actualizar tabla de roles, "Funcionalidades", "Límites conocidos" y la sección sin pantallas (queda solo lo que sigue siendo solo API); documentar `APP_URL`. Ajustar `tests/docs/readme.test.js` primero (falla) y luego el README.
  **Hecho cuando:** el test del README pasa.

- [ ] **T21 · Smoke de CI** — plan §4.6
  Pasos nuevos en el job `smoke`: crear servicio e invitar por API, verificar que `invitation_link` empiece con `APP_URL` y que `GET /activar?token=x` devuelva el HTML de la SPA.
  **Hecho cuando:** el workflow pasa en la rama.

- [ ] **T22 · Verificación final y recorrido manual** — criterios 1 y 2
  Suite completa en las dos zonas horarias y el flujo manual del criterio 2 con la demo sembrada (`docker compose up --build`).
  **Hecho cuando:** todo en verde, el recorrido funciona de punta a punta y se anota cualquier hallazgo como deuda o corrección.

## Notas de la implementación

- **Sin ejecutar en este entorno** (no hay Postgres ni acceso al daemon de Docker): T00 (línea base con DB), T04 (`invitationLink.test.js`, escrito pero no corrido), T19 (revisión manual a 360 px), T21 (el paso del smoke está escrito; falta ver el workflow en verde) y T22 (recorrido manual).
- **Verificado:** backend unit/docs en verde (301) en `TZ=UTC` y `America/Santiago`; frontend 189 tests, `lint` (2 advertencias previas), `typecheck` y `build` en verde; `docker compose config` muestra `APP_URL` en `backend`.
- **Desvío menor del plan:** `POST /staff` devuelve además `action` (`create | reactivate | resend`) porque el frontend no ve el status 200/201 y lo necesita para R5.
- **Deuda:** `editStaff` (cambio de email de un pendiente) todavía pasa el token pelado a `email.sendInvitation` y no devuelve enlace; la pantalla avisa que hay que usar «Reenviar invitación».
