# Spec 009 — Gestión del negocio en el panel: servicios, equipo y horarios

## Contexto y objetivo

Hoy el panel tiene tres pantallas con sesión: login y la agenda del día en solo lectura. Todo lo que el owner necesita para poner a funcionar el negocio —**servicios, trabajadores y horarios**— existe únicamente como API (specs 001, 002 y 004) y se opera con `curl` (README, "Operar el negocio sin pantallas"). Sin esas pantallas el flujo completo no se puede demostrar desde el navegador: la reserva pública (spec 005) depende de que haya servicios y trabajadores con horario, y nadie puede crearlos sin salir de la aplicación.

Además, la invitación de un trabajador (spec 002) termina en un **token pelado impreso en el log del backend** (`[email] invitación de trabajador → …: <token>`): no hay enlace ni pantalla de activación, así que el trabajador invitado no puede entrar nunca sin ayuda técnica.

Esta spec agrega, **solo en el frontend más lo mínimo en el backend para cerrar la invitación**, las pantallas para:

1. Gestionar servicios (crear, editar, cambiar precio, desactivar).
2. Gestionar el equipo (invitar, editar, reenviar invitación, desactivar) y editar el horario semanal de cada trabajador.
3. Que un trabajador edite su propio horario y su perfil.
4. Activar la cuenta de un trabajador desde un enlace real.

Incluye además un hallazgo ya corregido en `7cf9341` (ver RF-1) porque sin él las pantallas de equipo habrían mostrado en la red el hash de cada contraseña.

## Usuarios / actores

- **Owner**: gestiona servicios, equipo y el horario de cualquier trabajador.
- **Staff**: ve y edita su propio horario y su nombre/contraseña; no ve servicios ni equipo ajeno.
- **Trabajador invitado**: aún sin contraseña; abre el enlace de activación.

## Glosario

- **Enlace de activación**: `${APP_URL}/activar?token=<token>`; el token es el de la spec 002 (un solo uso, 72 h).
- **Vista de usuario**: el objeto de usuario que sale por HTTP (lista blanca de `domain/publicUser.js`).
- **Pantalla de gestión**: cualquier pantalla de este documento bajo `/owner/*` o `/staff/*`.

## Historias de usuario

- H1: Como owner quiero crear y editar mis servicios desde el panel para no depender de la API.
- H2: Como owner quiero invitar a un trabajador y entregarle un enlace que funcione.
- H3: Como trabajador invitado quiero abrir el enlace, definir mi contraseña y entrar.
- H4: Como owner quiero definir en qué días y horas atiende cada trabajador para que la reserva pública ofrezca horarios.
- H5: Como staff quiero ajustar mi propio horario sin pedírselo al owner (spec 004 H2).
- H6: Como owner quiero desactivar un servicio o un trabajador sin perder su historial.

## Requisitos funcionales (criterios de aceptación en EARS)

### Seguridad de las respuestas (entregado)

- RF-1: LAS respuestas HTTP que devuelven un usuario (`/staff`, `/staff/:id`, `PATCH /staff/:id`, `/staff/:id/deactivate`, `/staff/:id/resend-invitation`, `PATCH /me`, `POST /public/staff-invitations/activate`) contienen solo la vista de usuario —`id`, `account_id`, `name`, `email`, `role`, `status`, `commission_rate`, `created_at`, `updated_at`— y nunca `password_hash`. *Cubierto por `tests/integration/userResponses.test.js`; se registra aquí para que las pantallas dependan de un contrato explícito.*

### Navegación

- RF-2: MIENTRAS el usuario es owner, EL SISTEMA muestra en el encabezado del panel enlaces a **Agenda**, **Servicios** y **Equipo**; MIENTRAS es staff, a **Agenda** y **Mi horario**.
- RF-3: CUANDO un usuario abre una ruta de gestión que no corresponde a su rol, EL SISTEMA lo redirige a la agenda de su rol, como ya hacen `OwnerRoute` y `StaffRoute`.

### Servicios (`/owner/servicios`)

- RF-4: EL SISTEMA lista los servicios de la cuenta con nombre, duración y precio en CLP, separando activos de inactivos (`GET /services`).
- RF-5: CUANDO el owner crea un servicio con nombre, duración en minutos (entero > 0) y precio (≥ 0), EL SISTEMA llama a `POST /services` y lo agrega a la lista sin recargar la página.
- RF-6: CUANDO el owner edita nombre o duración, EL SISTEMA llama a `PATCH /services/:id`; CUANDO cambia el precio, llama a `PATCH /services/:id/prices` (el historial de precios lo conserva el backend, spec 001).
- RF-7: CUANDO el owner desactiva un servicio, EL SISTEMA pide confirmación, llama a `PATCH /services/:id/deactivate` y lo mueve a inactivos; los turnos existentes no cambian.
- RF-8: SI la API responde un error, ENTONCES EL SISTEMA muestra un mensaje en español para ese código (mapa en `domain/errors.ts`) y conserva lo que el usuario escribió.

### Equipo (`/owner/equipo`)

- RF-9: EL SISTEMA lista a los trabajadores con nombre, email, estado (`pendiente`, `activo`, `inactivo`) y comisión, con filtro por estado (`GET /staff?status=`).
- RF-10: CUANDO el owner invita con nombre, email y comisión opcional (0–100 %, se envía como fracción 0–1), EL SISTEMA llama a `POST /staff`. SI el email ya pertenece a otra cuenta, ENTONCES muestra "ese email ya está en uso" (`email_taken`); SI era un inactivo de esta cuenta, la respuesta 200 lo reactiva y la pantalla lo informa.
- RF-11: CUANDO la invitación se crea o se reenvía, EL SISTEMA muestra el **enlace de activación** con botón "Copiar" y el aviso "Aún no enviamos emails: entrégale este enlace al trabajador. Vence en 72 horas" (mismo criterio que el enlace de gestión del cliente, spec 005 D3).
- RF-12: CUANDO el owner edita nombre, email o comisión, EL SISTEMA llama a `PATCH /staff/:id` (comisión vacía = `null`, la comisión de la cuenta).
- RF-13: MIENTRAS un trabajador está `pendiente`, EL SISTEMA ofrece "Reenviar invitación" (`PATCH /staff/:id/resend-invitation`), que invalida el enlace anterior y muestra el nuevo.
- RF-14: CUANDO el owner desactiva a un trabajador, EL SISTEMA pide confirmación, llama a `PATCH /staff/:id/deactivate`. El texto de la confirmación avisa que sus turnos futuros se cancelarán (spec 002 RF-26); la respuesta no trae el conteo, así que la pantalla no lo muestra.

### Horario semanal (`/owner/equipo/:id/horario` y `/staff/horario`)

- RF-15: EL SISTEMA muestra el horario como siete filas (lunes a domingo) con cero o más tramos `inicio–fin` por día, cargado desde `GET /staff/:id/availability`.
- RF-16: CUANDO el usuario agrega, cambia o quita tramos y presiona "Guardar", EL SISTEMA envía **todo** el horario con `PUT /staff/:id/availability` (reemplazo total, spec 004).
- RF-17: ANTES de enviar, EL SISTEMA valida en el navegador lo mismo que el backend: `inicio < fin` y sin tramos que se solapen dentro del mismo día (dos tramos contiguos, como 09:00–12:00 y 12:00–15:00, son válidos, igual que en `domain/availabilityWindows.js`); marca la fila con el problema y no llama a la API. El backend sigue siendo la autoridad (422 `start_must_be_before_end`, `overlapping_windows`, …) y sus errores se muestran igual.
- RF-18: MIENTRAS el usuario es staff, `/staff/horario` carga y guarda solo el suyo (`/staff/<su id>/availability`); el owner abre el de cualquier trabajador `activo` o `pendiente` desde la lista de equipo. Un id ajeno o inexistente muestra "Trabajador no encontrado" (404).
- RF-19: CUANDO se guarda con éxito, EL SISTEMA lo confirma y deja de marcar cambios sin guardar; SI el usuario cierra o recarga la pestaña, o presiona "Volver", con cambios sin guardar, ENTONCES el navegador o un diálogo de la pantalla pide confirmación. Los enlaces del encabezado no se interceptan (D6).

### Perfil del trabajador

- RF-20: MIENTRAS el usuario es staff, EL SISTEMA permite en `/staff/horario` editar su nombre y cambiar su contraseña (`PATCH /me`, mínimo 8 caracteres, spec 008 RF-11). El email y la comisión no se editan (spec 002 RF-21).

### Activación de la cuenta

- RF-21: CUANDO el owner invita o reenvía, EL BACKEND devuelve además `invitation_link` en la respuesta de `POST /staff` y `PATCH /staff/:id/resend-invitation`, armado con `APP_URL`; solo esas dos respuestas lo incluyen y solo al owner.
- RF-22: EL BACKEND lee `APP_URL` en `loadConfig` (default `http://localhost:5173`; en producción debe ser `https://`, spec 008 RF-14) y el `emailService` imprime ese enlace en lugar del token pelado.
- RF-23: CUANDO alguien abre `/activar?token=…`, EL SISTEMA muestra un formulario de contraseña (≥ 8 caracteres y ≤ 72 bytes) y la confirma; CUANDO la API responde 200, inicia sesión con el email del usuario devuelto y la contraseña elegida y lleva al trabajador a `/staff/horario`.
- RF-24: SI la API responde 410 `token_expired`, ENTONCES EL SISTEMA muestra "Este enlace venció o ya se usó. Pídele al dueño del negocio uno nuevo", sin formulario. SI falta el parámetro `token`, muestra lo mismo.
- RF-25: `/activar` es pública: funciona con o sin sesión abierta y no usa el JWT del panel (cliente `apiPublic`, spec 005 RF-31).

### Calidad

- RF-26: TODAS las pantallas usan tuteo, locale `es-CL`, precios en CLP sin decimales y horas en 24 h (`HH:mm`).
- RF-27: Las pantallas funcionan en un ancho de 360 px sin scroll horizontal y todos los controles tienen etiqueta accesible.

## Fuera de alcance

- Crear, cancelar, reprogramar o bloquear turnos desde la agenda; pagos y resumen financiero → spec 010.
- Envío real de emails (SMTP/proveedor). Mientras tanto el owner entrega el enlace (RF-11).
- Recuperar contraseña olvidada; cambio de email propio del staff.
- Excepciones de calendario (feriados, vacaciones) y horarios por fecha.
- Editar la comisión por defecto de la cuenta (`PATCH /accounts/commission` sigue solo por API).
- Subir imágenes o descripciones de servicios.

## Criterios de finalización

1. `npm test` del backend en verde en `TZ=UTC` y `TZ=America/Santiago`; `npm test`, `npm run lint`, `npm run typecheck` y `npm run build` del frontend en verde.
2. Recorrido manual con la demo sembrada: owner crea un servicio → invita a un trabajador → copia el enlace → lo abre en una ventana privada → define su contraseña → queda dentro en "Mi horario" → guarda un horario → la reserva pública (`/reservar/<cuenta>`) ofrece huecos de ese trabajador.
3. El README deja de decir "solo por API" para servicios, equipo y horarios, y `tests/docs/readme.test.js` lo respalda.
4. Ninguna respuesta nueva ni modificada expone `password_hash` (RF-1) y el enlace de activación solo aparece en las dos respuestas del owner (RF-21).

## Decisiones

- **D1** — El enlace de activación viaja en la respuesta de la API al owner (RF-21) en vez de esperar al envío de email. Es el menor cambio que hace usable la invitación; el owner ya controla el alta del trabajador. Cuando exista el email real, el campo se mantiene o se retira sin tocar la pantalla de activación.
- **D2** — Una sola pantalla de horario sirve a owner y staff (RF-15..RF-19); solo cambia de quién carga el horario y desde dónde se llega.
- **D3** — Sin librerías de UI ni de formularios nuevas: componentes propios sobre el CSS actual (YAGNI). Se evalúa una librería si la spec 010 la justifica.
- **D4** — La validación de tramos del navegador (RF-17) es una copia deliberada y acotada de `domain/availabilityWindows.js`; se prueba con los mismos casos que el backend para que no diverjan.
- **D5** — El owner no tiene horario (spec 004 D5): la lista de equipo solo ofrece "Horario" a usuarios con rol `staff`.

- **D6** — La app usa `BrowserRouter`, que no admite `useBlocker`; migrar a un data router solo para interceptar la navegación sería un cambio de arquitectura desproporcionado. Se protege el cierre de pestaña (`beforeunload`) y el botón "Volver" de la propia pantalla.

## Preguntas abiertas

- **Q1** — ¿El enlace de activación debe poder volver a verse más tarde (guardar el token en claro) o solo en el momento de crear/reenviar? Propuesta: solo en el momento; se reenvía para obtener uno nuevo (no se guarda el token en claro).
- **Q2** — ¿Mostrar la comisión en % (0–100) o como fracción? Propuesta: % en pantalla, fracción en la API.
