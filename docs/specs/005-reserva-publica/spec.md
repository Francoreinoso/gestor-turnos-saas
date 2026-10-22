# Spec 005 — Reserva pública y autogestión del turno (frontend + endpoints públicos)

## Contexto y objetivo

El backend ya permite reservar sin login (`POST /public/bookings`), calcular horarios libres (`GET /availability/:business_id`) y cancelar o reprogramar con un token (`PATCH /public/appointments/:id/...?token=`). Pero el cliente final no puede usarlo: **no existe ninguna pantalla pública**, y la API pública está incompleta —no hay forma sin JWT de saber el nombre del negocio, sus servicios o sus profesionales, ni de ver qué turno es el que se está por cancelar—. Además el frontend actual llama a `POST /appointments`, que desde la spec 001 es solo del panel.
Esta spec define las dos pantallas públicas (reservar y gestionar un turno por enlace), los tres cambios mínimos de backend que las hacen posibles, y la infraestructura de tests del frontend. Es la primera spec que toca el frontend; fija sus convenciones.

## Usuarios / actores

- **Cliente (anónimo)**: persona que reserva o gestiona un turno desde el celular o la computadora, sin cuenta.
- **Owner / Staff**: no usan estas pantallas; sí se ven afectados por RF-9 y RF-10 (slots y reservas en el pasado).

## Glosario

- **Enlace de gestión**: URL `/turno/:id?token=<token>` que identifica un turno y autoriza a cancelarlo o reprogramarlo sin login (spec original §3.9). El token vive en la query string y nunca se guarda en el navegador.
- **Slot**: horario libre `{ employee_id, starts_at, ends_at }` devuelto por `GET /availability/:business_id`.
- **Cualquiera**: opción de reservar sin elegir profesional; el sistema autoasigna uno (diseño §3.7). Se envía la solicitud sin `employee_id`.
- **Plazo de gestión**: el token vence 2 horas antes del inicio del turno (`createAppointment`). Vencido, el cliente ya no puede cancelar ni reprogramar por esta vía.

## Historias de usuario

- H1: Como cliente quiero ver los servicios del negocio y elegir uno para saber qué puedo reservar.
- H2: Como cliente quiero elegir profesional (o "cualquiera"), día y horario entre los realmente libres.
- H3: Como cliente quiero reservar dejando solo mis datos de contacto y recibir un enlace para gestionar el turno después.
- H4: Como cliente quiero ver mi turno desde el enlace y cancelarlo si no puedo ir.
- H5: Como cliente quiero reprogramar mi turno a otro horario sin perderlo si no hay lugar.
- H6: Como negocio no quiero que se ofrezcan ni se acepten turnos en el pasado.

## Requisitos funcionales (criterios de aceptación en EARS)

### Backend — información pública del negocio

- RF-1: CUANDO se solicita `GET /public/accounts/:id`, EL SISTEMA devuelve el nombre del negocio, sus servicios **activos** (`id`, `name`, `duration_minutes`, `price`) y sus profesionales: usuarios con rol `staff` y estado `activo` (`id`, `name`), ambos ordenados por nombre (salida 200). No requiere autenticación.
- RF-2: EL SISTEMA no incluye en esa respuesta ningún otro dato: ni emails, ni comisiones, ni ids de cuenta de terceros, ni servicios inactivos, ni usuarios `pendiente`/`inactivo`/owner.
- RF-3: SI el negocio no existe o el `id` no es un UUID válido, ENTONCES EL SISTEMA responde 404 `{ "error": "not_found" }` (nunca 500).
- RF-4: CUANDO un negocio no tiene servicios activos o no tiene profesionales, EL SISTEMA responde 200 con las listas vacías correspondientes; decidir qué mostrar es tarea del frontend.

### Backend — consulta pública de un turno

- RF-5: CUANDO se solicita `GET /public/appointments/:id?token=`, con un token válido para ese turno, EL SISTEMA devuelve: `id`, `account_id`, `status`, `scheduled_at`, `scheduled_until`, `service` (`id`, `name`, `duration_minutes`, `price`), `professional` (`id`, `name`) y `business_name` (salida 200).
- RF-6: EL SISTEMA no devuelve datos personales del cliente (email, teléfono, notas) en esa respuesta.
- RF-7: SI falta el token, es incorrecto o corresponde a otro turno, ENTONCES EL SISTEMA responde 401 `unauthorized`; SI está vencido, responde 401 `token_expired` (mismo comportamiento que `publicAuth`). Un id inexistente o que no es un UUID válido responde 401, no 404 ni 500, para no confirmar existencia. Esto vale también para cancelar y reprogramar, que comparten `publicAuth`.
- RF-8: EL SISTEMA limita las dos lecturas nuevas (RF-1, RF-5) con un tope propio de 120 solicitudes cada 15 minutos por IP, separado del tope estricto de 20 cada 15 minutos que conservan reservar, cancelar, reprogramar y activar cuenta de trabajador. Superado el tope, responde 429 `too_many_requests`.

### Backend — nada en el pasado

- RF-9: CUANDO se calculan horarios libres, EL SISTEMA no incluye slots cuyo inicio sea anterior o igual al momento actual.
- RF-10: SI una reserva pública (`POST /public/bookings`) o una reprogramación (`PATCH /public/appointments/:id/reschedule`) pide un inicio anterior o igual al momento actual, ENTONCES EL SISTEMA responde 422 `appointment_in_past` sin crear ni cancelar nada. Las reservas del panel (spec 001) conservan su permiso de cargar turnos pasados.
- RF-10b: SI `scheduled_at` de una reserva pública o de una reprogramación no es un instante ISO 8601 válido, ENTONCES EL SISTEMA responde 400 `invalid_scheduled_at` sin crear ni cancelar nada (hoy llega a la base y responde 500).

### Frontend — reserva (`/reservar/:accountId`)

- RF-11: CUANDO se abre `/reservar/:accountId`, EL SISTEMA muestra el nombre del negocio y sus servicios activos con duración y precio; SI el negocio no existe (404) muestra un mensaje "Negocio no encontrado" sin formulario.
- RF-12: SI el negocio no tiene servicios activos o profesionales (RF-4), ENTONCES EL SISTEMA muestra "Este negocio todavía no acepta reservas online" sin continuar el flujo.
- RF-13: EL SISTEMA guía la reserva en pasos dentro de la misma página: servicio → profesional → día y horario → datos → confirmación; el cliente puede volver a un paso anterior sin perder lo ya elegido.
- RF-14: EN el paso de profesional, EL SISTEMA ofrece "Cualquiera" (por defecto) y cada profesional activo de RF-1.
- RF-15: EN el paso de día y horario, EL SISTEMA consulta los slots de los próximos 14 días con una única solicitud a `GET /availability/:business_id` (con `service_id` y, si se eligió profesional, `employee_id`), agrupa por día y deshabilita los días sin horarios.
- RF-16: CUANDO el profesional elegido es "Cualquiera", EL SISTEMA muestra cada horario una sola vez aunque varios profesionales lo tengan libre, y envía la reserva sin `employee_id`. CUANDO se eligió uno, envía su `employee_id`.
- RF-17: SI no hay ningún horario en los próximos 14 días, ENTONCES EL SISTEMA lo informa y permite cambiar de servicio o profesional.
- RF-18: EN el paso de datos, EL SISTEMA exige nombre y al menos email o teléfono, valida su formato antes de enviar (email con `@`; teléfono en formato internacional `+` seguido de 7 a 15 dígitos, la regla del backend) y ofrece un campo opcional de notas.
- RF-19: CUANDO el cliente confirma, EL SISTEMA envía `POST /public/bookings` (`account_id`, `service_id`, `scheduled_at`, `client`, `employee_id` si corresponde, `notes`) y deshabilita el botón mientras la solicitud está en curso para evitar reservas duplicadas.
- RF-20: CUANDO la reserva se crea (201), EL SISTEMA muestra un resumen (servicio, profesional asignado, fecha y hora) y el enlace de gestión `/turno/:id?token=…` completo, con un botón para copiarlo y el aviso de que **es la única forma de cancelar o reprogramar y que debe guardarse**.
- RF-21: SI la reserva falla con 409 (`appointment_overlap` o `no_professional_available`), ENTONCES EL SISTEMA informa que el horario ya no está disponible, recarga los slots y devuelve al cliente al paso de día y horario conservando sus datos.
- RF-22: SI la reserva falla con 429, 400, 404 o de red, ENTONCES EL SISTEMA muestra un mensaje en español específico y permite reintentar sin perder lo cargado.

### Frontend — gestión del turno (`/turno/:id?token=`)

- RF-23: CUANDO se abre el enlace, EL SISTEMA consulta RF-5 y muestra servicio, profesional, fecha, hora, negocio y estado en español.
- RF-24: SI la respuesta es 401 `token_expired`, ENTONCES EL SISTEMA muestra que el plazo para modificar el turno venció y que debe comunicarse con el negocio; SI es 401 `unauthorized`, muestra "Enlace inválido".
- RF-25: MIENTRAS el estado del turno es `agendado`, EL SISTEMA ofrece "Cancelar turno" y "Reprogramar"; en cualquier otro estado muestra solo la información, sin acciones.
- RF-26: CUANDO el cliente elige cancelar, EL SISTEMA pide confirmación explícita y, al confirmarse, envía `PATCH /public/appointments/:id/cancel?token=` y muestra el turno como cancelado.
- RF-27: CUANDO el cliente elige reprogramar, EL SISTEMA muestra los slots (misma consulta y agrupación que RF-15) **del mismo servicio y del mismo profesional asignado**, y al elegir uno pide confirmación.
- RF-28: CUANDO se confirma la reprogramación (201), EL SISTEMA muestra el turno nuevo y su **nuevo enlace de gestión** (el token anterior deja de servir porque el turno viejo queda cancelado), con las mismas indicaciones de RF-20.
- RF-29: SI la reprogramación falla con 409 o 422 `appointment_in_past`, ENTONCES EL SISTEMA informa el motivo, recarga los slots y el turno original sigue intacto.
- RF-30: EL SISTEMA no guarda el token en `localStorage` ni en cookies; solo vive en la URL abierta.

### Frontend — transversal

- RF-31: LAS pantallas públicas llaman a la API **sin** enviar el JWT del panel y **sin** disparar el cierre de sesión ante un 401: un owner logueado que prueba la reserva no debe ser deslogueado.
- RF-32: LAS rutas `/reservar/:accountId` y `/turno/:id` son accesibles con o sin sesión iniciada y no redirigen según el rol.
- RF-33: EL SISTEMA traduce los códigos de error de la API a mensajes en español en un solo lugar; un código desconocido muestra un mensaje genérico, nunca el código crudo.
- RF-34: LAS pantallas son usables desde 360 px de ancho sin scroll horizontal; los controles son operables por teclado y los campos tienen etiquetas asociadas.
- RF-35: LAS fechas y horas se muestran en `es-AR` en la zona horaria del navegador.

## Requisitos no funcionales

- Stack del frontend sin cambios (React, TypeScript, Vite, React Router, CSS plano existente). Única dependencia nueva, justificada abajo: herramientas de test.
- Los endpoints nuevos siguen la forma de error uniforme `{ "error": "<código>" }` y las capas de la constitución (reglas en `domain/`, orquestación en `application/`, Express/Drizzle en `infrastructure/`).
- El enlace de gestión no se incluye en logs del servidor ni se envía a terceros (no hay analytics).
- Idioma de la interfaz, mensajes y documentación: español.

## Notas de arquitectura

- **Dependencias nuevas (principio 1):** `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event` y `@testing-library/jest-dom`, todas `devDependencies` del frontend. Justificación: la constitución exige TDD (principio 9) y el frontend no tiene runner; Vitest comparte la configuración de Vite ya presente, evitando una segunda cadena de build. No entran al bundle de producción.
- **Cliente HTTP:** `services/api.ts` hoy adjunta el JWT y emite `auth:logout` ante cualquier 401. RF-31 exige un cliente público separado (`apiPublic`) en el mismo módulo, sin esos dos comportamientos.
- **Lógica pura fuera de los componentes** (`domain/` del frontend): agrupar slots por día, deduplicar por horario, mapear errores, armar el enlace de gestión. Es lo que se prueba primero.
- **El paso a paso vive en un solo componente con estado**, sin una ruta por paso: no hay requisito de enlazar ni de volver con el botón "atrás" del navegador a un paso intermedio.
- **Zona horaria:** los slots se calculan en la hora local del servidor (limitación vigente del diseño). El frontend asume navegador y servidor en la misma zona; el manejo de zonas por negocio sigue fuera de alcance y se registra como deuda en el README (spec 006).
- RF-10 modifica un caso de uso compartido (`createAppointment`/`rescheduleAppointment`); la regla "no pasado" se aplica solo en las rutas públicas para no alterar el permiso de la spec 001 (RF-8 de esa spec).
- `routes/public.js` hoy aplica un único limitador estricto a todo el grupo `/public/*`; pasa a haber dos (RF-8), cada uno aplicado por ruta.

## Casos límite

- Dos clientes eligen el mismo horario a la vez → el segundo recibe 409 y vuelve a elegir (RF-21); el trigger de la base es la salvaguarda final.
- Turno que empieza en menos de 2 horas → el token ya venció: el enlace muestra "plazo vencido" (RF-24) aunque el turno siga `agendado`.
- Enlace de un turno ya cancelado o reprogramado → se muestra como `cancelado`, sin acciones (RF-25).
- Reprogramar a un horario que otro tomó mientras se miraba → 409, el turno original sigue `agendado` (RF-29).
- Doble clic en "Confirmar" → una sola reserva (RF-19).
- Cliente existente (mismo email o teléfono) → el backend reutiliza su ficha (find-or-create); la pantalla no lo distingue.
- Teléfono sin `+` o con letras → rechazado en el cliente antes de enviar (RF-18).
- `:accountId` no UUID → "Negocio no encontrado" (RF-3, RF-11).
- Owner logueado abre `/reservar/...` → ve la página pública normal y su sesión sigue activa (RF-31, RF-32).
- Navegador sin `clipboard` → el enlace queda visible y seleccionable aunque falle "Copiar" (RF-20).

## Fuera de alcance

- Enviar el enlace por email, WhatsApp u otro canal (`notifications`): el cliente lo recibe solo en pantalla (D3). Primer candidato de una spec posterior.
- Pantalla de activación de la cuenta del trabajador invitado (`/public/staff-invitations/activate` ya existe).
- Pantallas del panel para gestionar servicios, staff y horarios, y acciones sobre la agenda.
- Marca propia, slug o dominio por negocio, SEO y renderizado en servidor.
- Pagos online, captcha, política de cancelación, exportar a calendario (.ics).
- Zonas horarias por negocio; internacionalización más allá del español.
- Cambiar de servicio o de profesional al reprogramar.

## Criterios de finalización

- Cada RF con test automatizado. Se priorizan los casos no obvios:
  1. Lo público no filtra datos: RF-1/RF-2 (sin emails ni inactivos) y RF-5/RF-6 (sin datos del cliente); id no UUID → 404 y no 500 (RF-3).
  2. Token incorrecto, de otro turno y vencido en la consulta pública (RF-7).
  3. No hay slots ni reservas en el pasado, pero el panel sí puede cargar turnos pasados (RF-9, RF-10).
  4. "Cualquiera" deduplica horarios y no envía `employee_id`; un profesional concreto sí lo envía (RF-16).
  5. Un 409 al confirmar vuelve al paso de horarios conservando los datos (RF-21); el botón deshabilitado evita la reserva doble (RF-19).
  6. Un 401 de las pantallas públicas no cierra la sesión del panel y no se manda el JWT (RF-31).
  7. Reprogramar fallido deja el turno original intacto (RF-29); el enlace nuevo reemplaza al viejo (RF-28).
  8. El token nunca llega a `localStorage` (RF-30).
- `npm test` y `npm run db:migrate` del backend en verde; `npm test`, `npm run lint` y `npm run build` del frontend en verde.
- Demo manual: abrir `/reservar/:accountId` sin sesión → elegir servicio, "Cualquiera", un horario, datos → ver el enlace → abrirlo en otra pestaña → reprogramar a otro horario y verificar el enlace nuevo → cancelar → intentar el enlace viejo (turno cancelado, sin acciones) → repetir con un turno a menos de 2 horas (plazo vencido).

## Dudas abiertas

- Ninguna. Q1 y Q2 de la primera redacción están resueltas; ver D8 y D9.

## Registro de decisiones

- **D1** — La información pública sale de un único `GET /public/accounts/:id`, no de reutilizar `/services` y `/staff` sin auth: esos exponen datos internos (comisiones, emails, estados) y tienen reglas de rol propias.
- **D2** — El flujo de reserva es un asistente en una sola página (RF-13). No se versiona cada paso en la URL porque no hay requisito de compartir ni retomar un paso.
- **D3** — Sin notificaciones, el enlace de gestión se muestra en pantalla con aviso explícito (RF-20, RF-28). Es el menor flujo que cumple el diseño §3.9 sin sumar infraestructura de envío; la deuda queda registrada en "Fuera de alcance".
- **D4** — "Nada en el pasado" se aplica solo a las rutas públicas (RF-10), porque la spec 001 (RF-8) permite explícitamente cargar turnos pasados desde el panel.
- **D5** — Reprogramar mantiene servicio y profesional (RF-27): es lo que hace hoy `rescheduleAppointment` por defecto y evita ofrecer slots que el caso de uso luego no puede honrar.
- **D6** — Un id de turno inexistente responde 401 en la consulta pública (RF-7), igual que un token incorrecto: no se confirma la existencia de turnos ajenos.
- **D7** — Vitest sobre Jest (misma configuración que Vite); Testing Library para probar comportamiento visible y no detalles de implementación.
- **D8** — (Q1) El precio se muestra en la página pública (RF-1, RF-11): es dato de catálogo del negocio y el cliente lo necesita para decidir.
- **D9** — (Q2) Dos limitadores en `/public/*` (RF-8): 120/15 min para las lecturas nuevas y 20/15 min para las escrituras y la activación. Las lecturas no modifican nada y la pantalla de gestión recarga datos; el tope estricto sigue frenando fuerza bruta sobre tokens, que es su razón de ser.
- **D10** — RF-5 incluye `account_id` del negocio: reprogramar (RF-27) necesita consultar `GET /availability/:business_id` y la pantalla de gestión no tiene otra forma de conocerlo. No es un dato sensible: ya viaja en la URL pública de reserva (`/reservar/:accountId`). Agregado durante la implementación.
