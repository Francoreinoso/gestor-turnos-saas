# Spec 010 — Agenda operativa y pagos en el panel

## Contexto y objetivo

Con la spec 009 el owner puede configurar el negocio desde el navegador (servicios, equipo, horarios). Lo que sigue sin pantalla es la **operación diaria**, que hoy solo existe como API (specs 001 y 003):

- La agenda del día (`DashboardPage`) es de **solo lectura**: no se puede crear un turno, cancelarlo, bloquear un horario ni marcar que el cliente no llegó.
- El **resumen financiero y el detalle de pagos** no se ven en ninguna parte.

Esta spec agrega esas pantallas y cierra un hueco de autorización que apareció al revisarlas: `PATCH /appointments/:id/correct` no aplica el alcance por rol de la spec 001 (RF-31, RF-34) y permite a un trabajador corregir —y por tanto crear o borrar pagos de— turnos de otro trabajador de su cuenta.

Cierra además una limitación de zona horaria que las pantallas de pagos harían visible: los presets de período (`hoy`, `esta_semana`, `este_mes`) se calculan en UTC, y en Chile (UTC−3/−4) "hoy" corta a las 20:00–21:00 locales.

## Usuarios / actores

- **Owner**: opera la agenda de todo el negocio y ve el dinero de toda la cuenta.
- **Staff**: opera solo su propia agenda y ve solo sus propios pagos.

## Glosario

- **Turno**: fila de `appointments` con cliente y servicio (`agendado`, `en_progreso`, `completado`, `no_llego`, `cancelado`).
- **Bloqueo**: fila con estado `bloqueado`: horario no ofrecible, sin cliente (de un profesional o de todo el negocio).
- **Corregir**: alternar un turno entre `completado` y `no_llego` (spec 003 RF-19/RF-20); crea o borra su pago.
- **Día local**: de las 00:00 a las 23:59:59.999 en la zona horaria del navegador.
- **Pago**: fila de `payments` con monto, parte del profesional y parte del negocio, creada al completarse un turno.

## Historias de usuario

- H1: Como owner o staff quiero cargar un turno en la agenda (por teléfono o en persona) sin salir de la aplicación.
- H2: Como owner o staff quiero cancelar un turno y bloquear horarios.
- H3: Como owner o staff quiero marcar que un cliente no llegó, o deshacerlo, mientras sea corregible.
- H4: Como owner quiero ver cuánto se facturó en un período, cuánto es del negocio y cuánto de cada trabajador.
- H5: Como staff quiero ver lo que he ganado y de qué turnos viene.
- H6: Como owner quiero que un trabajador no pueda tocar turnos ni pagos de otro.

## Requisitos funcionales (criterios de aceptación en EARS)

### Autorización (backend)

- RF-1: CUANDO un staff corrige un turno (`PATCH /appointments/:id/correct`) cuyo profesional asignado es otro trabajador, o que es un bloqueo de negocio, EL SISTEMA responde 404 `not_found` sin modificar el turno ni sus pagos (spec 001 RF-31, RF-34). El owner conserva acceso a cualquier turno de su cuenta.
- RF-2: EL SISTEMA aplica el mismo alcance por rol a **todas** las rutas de `/appointments/:id…` (`GET`, `PATCH`, `cancel`, `cancel-block`, `correct`); un test recorre todas con un staff ajeno y espera 404.

### Agenda del día (`/owner/agenda` y `/staff/agenda`)

- RF-3: LA agenda muestra los turnos y bloqueos del día local seleccionado en orden de hora, con hora de inicio y fin en 24 h, cliente, servicio, profesional (solo para el owner) y estado; los bloqueos se distinguen visualmente y no muestran cliente.
- RF-4: EL owner puede filtrar la agenda por profesional; el staff ve siempre solo la suya (spec 001 RF-42).
- RF-5: CUANDO no hay turnos, LA agenda lo dice ("No hay turnos para este día") y ofrece "Nuevo turno".
- RF-6: CUANDO el listado alcanza el máximo de 500 elementos (spec 001 RF-41), LA agenda avisa que puede haber más.

### Crear turno

- RF-7: CUANDO el usuario presiona "Nuevo turno", LA pantalla abre un formulario con servicio (solo activos), fecha y hora (por defecto, la del día mostrado), cliente y notas; el owner agrega profesional (por defecto "Asignar automáticamente").
- RF-8: EL cliente se elige entre los existentes (búsqueda por nombre, email o teléfono sobre `GET /clients`) o se ingresa uno nuevo (nombre y al menos email o teléfono); enviado como `client_id` o `client` a `POST /appointments`.
- RF-9: CUANDO la API responde 201, LA agenda incluye el turno sin recargar; SI el turno quedó en el pasado y se creó `completado`, LA pantalla lo informa ("Quedó registrado como completado y generó su pago", spec 001 RF-9).
- RF-10: SI la API responde `appointment_overlap` (409), `no_professional_available` (409), `service_not_found` o `professional_not_found` (404), `client_not_found`, o un error de validación, ENTONCES EL formulario muestra el mensaje en español y conserva lo escrito.
- RF-11: EL staff no elige profesional: el turno se le asigna a él (spec 001 RF-16).
- RF-12: LA pantalla no aplica el horario del profesional: el panel puede cargar turnos fuera de horario (spec 001 RF-5); si el horario elegido queda fuera de la disponibilidad semanal del profesional, muestra una advertencia no bloqueante.

### Cancelar y bloquear

- RF-13: CUANDO el usuario cancela un turno `agendado`, LA pantalla pide confirmación, llama a `PATCH /appointments/:id/cancel` y actualiza la fila; para turnos que no están `agendado` la acción no se ofrece.
- RF-14: CUANDO el usuario crea un bloqueo con fecha, hora de inicio, hora de fin y nota opcional, LA pantalla llama a `POST /appointments/block`; el owner elige "Todo el negocio" o un profesional, el staff siempre el suyo (`appointment_overlap` se muestra como en RF-10).
- RF-15: CUANDO el usuario cancela un bloqueo, LA pantalla pide confirmación y llama a `PATCH /appointments/:id/cancel-block`.
- RF-16: EL fin de un bloqueo debe ser posterior a su inicio; el formulario lo valida antes de enviar.

### Marcar asistencia

- RF-17: PARA un turno `completado`, LA pantalla ofrece "Marcar como no llegó"; PARA uno `no_llego`, "Marcar como completado"; ambas llaman a `PATCH /appointments/:id/correct` tras confirmar y solo mientras la ventana de corrección esté vigente (hasta el fin del día UTC siguiente al turno, spec 003 RF-19). Fuera de la ventana, la acción no se ofrece; SI la API responde `correction_window_expired` (422), la pantalla lo explica.
- RF-18: CUANDO la corrección es a `no_llego`, LA pantalla avisa que el pago de ese turno se elimina; CUANDO es a `completado`, que se crea.

### Edición de un turno agendado

- RF-19: PARA un turno `agendado`, EL usuario puede editar notas, servicio, cliente y (solo el owner) profesional, con `PATCH /appointments/:id`. La fecha y hora no se editan (spec 001 RF-24); para moverlo se cancela y se crea otro.

### Pagos (`/owner/pagos` y `/staff/pagos`)

- RF-20: LA pantalla permite elegir el período: "Hoy", "Esta semana", "Este mes" o un rango de fechas; el período se calcula en el **día local** del navegador y se envía como `date_from`/`date_to` (rango libre) a `GET /payments/summary` y `GET /payments` (D2). El valor por defecto es "Este mes".
- RF-21: EL resumen muestra total cobrado, parte del negocio, parte de los trabajadores y cantidad de pagos, en CLP sin decimales. Para el staff, solo su parte y la cantidad.
- RF-22: PARA el owner, EL resumen incluye el desglose por profesional (`byEmployee`) y un filtro por profesional (`employee_id`).
- RF-23: EL detalle lista los pagos del período (fecha del turno, cliente, servicio, monto, parte del profesional, parte del negocio) más recientes primero; CUANDO `hasMore` es verdadero, avisa que se muestran los primeros 500.
- RF-24: CUANDO un pago no tiene comisión resuelta (spec 003 RF-5), LA pantalla muestra "Sin comisión definida" en vez de un monto de 0 y enlaza a "Equipo" (owner).
- RF-25: LA pantalla de pagos no ofrece ninguna acción de escritura: los pagos se crean y borran solo por el ciclo del turno (RF-17).

### Calidad

- RF-26: Las pantallas siguen los criterios de la spec 009 (tuteo, `es-CL`, CLP, 24 h, 360 px, etiquetas accesibles, errores mapeados en español).
- RF-27: LA agenda y los pagos usan el día local del navegador; cualquier límite que siga en UTC se documenta en pantalla (la ventana de corrección, RF-17) y en el README.

## Fuera de alcance

- Reprogramar un turno desde el panel (no existe en la API del panel; el cliente reprograma con su enlace, spec 005).
- Calendario semanal o mensual con arrastrar y soltar; la agenda sigue siendo por día.
- Crear, editar o borrar pagos manualmente; propinas, descuentos, medios de pago.
- Exportar a CSV o imprimir reportes.
- Editar la comisión por defecto de la cuenta y por trabajador desde pantalla (`PATCH /accounts/commission`, `/accounts/users/:id/commission`); se enlaza a Equipo y sigue por API hasta una spec posterior.
- Notificaciones al cliente por cambios hechos desde el panel (no hay envío de emails).
- Zona horaria por negocio: los slots siguen usando la hora del servidor (README).

## Criterios de finalización

1. Backend en verde en `TZ=UTC` y `America/Santiago`; frontend con `test`, `lint`, `typecheck` y `build` en verde.
2. Recorrido manual con la demo: owner crea un turno pasado para un trabajador → aparece `completado` y en Pagos → lo marca "No llegó" → el pago desaparece del resumen → lo vuelve a "Completado" → crea un turno futuro, lo cancela, bloquea una tarde y la reserva pública deja de ofrecer esos horarios; luego el mismo trabajador entra y solo ve lo suyo.
3. Un staff recibe 404 al corregir un turno de otro (RF-1) y el test de recorrido de rutas (RF-2) lo respalda.
4. El README deja de listar la operación de turnos y pagos como "solo API" y el test del README lo respalda.

## Decisiones

- **D1** — El alcance por rol se corrige en el backend (RF-1, RF-2) antes de poner botones: una pantalla que expone la acción hace explotable un hueco que hoy solo alcanza un cliente HTTP.
- **D2** — Los períodos de las pantallas viajan como rango libre calculado en el navegador y no con los presets de la API, para que "hoy" sea el día local sin tocar el contrato de la spec 003 (que define los presets en UTC, RF-14). Los presets del backend se mantienen para otros clientes. Una spec futura de zona horaria por negocio los reemplazaría.
- **D3** — La corrección conserva su ventana en UTC (spec 003); la pantalla solo refleja la regla (RF-17) y la documenta, en vez de duplicarla con otra definición de "día".
- **D4** — Sin librerías de calendario, de tablas ni de formularios (YAGNI, D3 de la spec 009): selectores nativos `date`/`time` y componentes propios.
- **D5** — El formulario de turno no valida disponibilidad (RF-12) porque el panel existe, precisamente, para cargar lo que ocurre fuera del flujo público; solo advierte.

## Preguntas abiertas

- **Q1** — ¿El staff puede ver el detalle de pagos con el nombre del cliente? La spec 003 no lo prohíbe; propongo mostrarlo, pues es su propio cliente.
- **Q2** — ¿Deben poder corregir asistencia los staff sobre sus propios turnos? Hoy el backend lo permite sin alcance (el hueco de RF-1); propongo que sí, solo sobre los suyos.
- **Q3** — ¿Conviene un resumen de "hoy" en la propia agenda (turnos y monto del día) o basta con la pantalla de pagos? Propongo dejarlo fuera para esta spec.
