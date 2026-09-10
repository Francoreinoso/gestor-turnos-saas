# Spec 001 — CRUD de appointments (panel autenticado)

## Contexto y objetivo

El personal del negocio (owner y staff) necesita gestionar turnos desde un
panel con login, no solo recibirlos por el booking público. Hoy pueden
listar, ver, cancelar, bloquear y corregir, pero no **crear** un turno ni
**editar** los datos de uno existente estando autenticados. Esta spec define
esas dos operaciones —incluida la carga de turnos ya ocurridos para dejar
registro— y fija por escrito, de forma verificable, el comportamiento de
listado, detalle y baja para que el CRUD quede completo y sin ambigüedades.

## Usuarios / actores

- **Owner**: dueño del negocio. Gestiona cualquier turno de su cuenta.
- **Staff**: profesional. Gestiona únicamente los turnos que tiene asignados.

## Glosario

- **Editar**: modificar in-place los campos de un turno existente sin cambiar su identidad ni su fila. Es el término que usa esta spec; "modificar" y "actualizar" son sinónimos.
- **Reprogramar**: cancelar la fila de un turno y crear otra con nueva fecha/hora de inicio. Fuera del alcance de esta spec.
- **Bloqueo**: fila de `appointments` en estado `bloqueado`. Con profesional asignado bloquea la agenda de ese profesional; sin profesional asignado (**bloqueo de negocio**) bloquea la de toda la cuenta.
- **Solapamiento**: dos franjas `[inicio, fin)` se solapan si `a.inicio < b.fin` y `b.inicio < a.fin`. Turnos adyacentes (fin de uno igual al inicio del otro) **no** se solapan.

## Historias de usuario

- H1: Como owner quiero cargar un turno desde el panel para registrar reservas tomadas por teléfono o presencialmente.
- H2: Como owner quiero registrar un turno ya ocurrido para dejar constancia de la atención y su cobro.
- H3: Como staff quiero corregir el servicio, el cliente o las notas de un turno mío mal cargado sin tener que cancelarlo y rehacerlo.
- H4: Como owner quiero reasignar un turno a otro profesional cuando el asignado no puede atenderlo.
- H5: Como staff quiero ver solo mis turnos al abrir la agenda.

## Requisitos funcionales (criterios de aceptación en EARS)

### Crear desde el panel

- RF-1: CUANDO un usuario autenticado solicita crear un turno indicando cliente (por `client_id` existente o por datos de un cliente nuevo), servicio y fecha/hora de inicio, y la fecha/hora de fin resultante es futura, EL SISTEMA crea el turno en estado `agendado` y lo devuelve (salida 201).
- RF-2: EL SISTEMA fija la fecha/hora de fin del turno como la fecha/hora de inicio más la duración del servicio indicado.
- RF-3: CUANDO la creación aporta datos de un cliente nuevo en lugar de un `client_id`, EL SISTEMA reutiliza el cliente de la cuenta que coincida por email o teléfono, o crea uno nuevo si no hay coincidencia (find-or-create), igual que el booking público.
- RF-4: SI la solicitud no incluye cliente (ni `client_id` ni datos), servicio o fecha/hora de inicio, ENTONCES EL SISTEMA rechaza la creación (salida 400) sin crear la fila.
- RF-5: DONDE la solicitud indica un profesional explícito, EL SISTEMA asigna ese profesional sin validar su horario de disponibilidad.
- RF-6: CUANDO la solicitud no indica profesional, EL SISTEMA autoasigna el primer profesional de la cuenta cuya disponibilidad semanal cubre la franja del turno y que no tiene otro turno ni bloqueo solapado.
- RF-7: SI la solicitud no indica profesional y ningún profesional de la cuenta cumple las condiciones de RF-6, ENTONCES EL SISTEMA rechaza la creación (salida 409) sin crear la fila.
- RF-8: EL SISTEMA acepta una fecha/hora de inicio anterior al momento actual, sin cota inferior (registro a posteriori).
- RF-9: CUANDO la fecha/hora de fin resultante es anterior o igual al momento actual, EL SISTEMA crea el turno directamente en estado `completado` y registra el pago correspondiente dentro de la misma transacción; SI esa transacción falla, no se crea el turno ni el pago.
- RF-10: SI el turno a crear se solapa con otro turno no cancelado del mismo profesional, o con un bloqueo del profesional asignado o de negocio, ENTONCES EL SISTEMA rechaza la creación (salida 409) sin crear la fila.
- RF-11: SI el servicio indicado no existe, no está activo o no pertenece a la cuenta del usuario, ENTONCES EL SISTEMA rechaza la creación (salida 404).
- RF-12: SI la duración del servicio indicado no es un número positivo de minutos, ENTONCES EL SISTEMA rechaza la creación (salida 422).
- RF-13: SI se indica un `client_id` que no existe o no pertenece a la cuenta del usuario, ENTONCES EL SISTEMA rechaza la creación (salida 404).
- RF-14: SI se indica un profesional que no existe, está dado de baja o no pertenece a la cuenta del usuario, ENTONCES EL SISTEMA rechaza la creación (salida 404).
- RF-15: SI la fecha/hora de inicio no es un instante válido en formato ISO 8601, ENTONCES EL SISTEMA rechaza la creación (salida 400).
- RF-16: MIENTRAS el usuario tiene rol staff, EL SISTEMA asigna el turno creado al propio staff e ignora sin error cualquier profesional recibido en la solicitud; esta regla tiene precedencia sobre RF-5.
- RF-17: CUANDO se crea un turno en estado `agendado`, EL SISTEMA genera un enlace de autogestión para el cliente y lo incluye en la respuesta 201.
- RF-18: CUANDO se crea un turno en estado `completado` (RF-9), EL SISTEMA no genera enlace de autogestión.

### Editar un turno existente (in-place)

- RF-19: CUANDO un usuario autorizado edita un turno en estado `agendado`, EL SISTEMA aplica los cambios recibidos sobre notas, servicio, profesional y/o cliente y devuelve el turno actualizado (salida 200).
- RF-20: EL SISTEMA interpreta un campo ausente del cuerpo como "sin cambio" y un campo presente como asignación al valor recibido; `notes` admite `null` o cadena vacía para limpiarse; `client`, `service` y `profesional` no admiten `null`.
- RF-21: SI la solicitud de edición no incluye ningún campo editable, ENTONCES EL SISTEMA la rechaza (salida 400) sin modificar la fila.
- RF-22: SI la solicitud de edición incluye algún campo no editable (`status`, `scheduled_at`, `scheduled_until`, `account_id`, entre otros), ENTONCES EL SISTEMA la rechaza (salida 400) sin modificar la fila.
- RF-23: SI se intenta editar un turno que no está en estado `agendado`, ENTONCES EL SISTEMA rechaza la edición (salida 422) sin modificar la fila.
- RF-24: EL SISTEMA no modifica la fecha/hora de inicio en la edición in-place; ese cambio se realiza por reprogramación.
- RF-25: CUANDO la edición cambia el servicio, EL SISTEMA mantiene la fecha/hora de inicio y recalcula la fecha/hora de fin como inicio más la duración del nuevo servicio. Es el único cambio in-place que desplaza el fin; se acepta porque el inicio, ancla de la agenda, no se mueve.
- RF-26: SI la edición indica un servicio inexistente, inactivo o de otra cuenta, ENTONCES EL SISTEMA rechaza la edición (salida 404).
- RF-27: SI la edición indica un cliente inexistente o de otra cuenta, ENTONCES EL SISTEMA rechaza la edición (salida 404).
- RF-28: SI la edición indica un profesional inexistente, dado de baja o de otra cuenta, ENTONCES EL SISTEMA rechaza la edición (salida 404).
- RF-29: SI el estado final del turno tras aplicar todos los cambios de la solicitud se solapa con otro turno no cancelado o con un bloqueo, ENTONCES EL SISTEMA rechaza la edición (salida 409) sin modificar la fila.

### Alcance por rol

- RF-30: MIENTRAS el usuario tiene rol owner, EL SISTEMA le permite crear, editar y cancelar cualquier turno de su cuenta, incluidos los bloqueos de negocio.
- RF-31: MIENTRAS el usuario tiene rol staff, EL SISTEMA solo le permite editar o cancelar turnos y bloqueos cuyo profesional asignado es él mismo.
- RF-32: SI un usuario con rol staff solicita gestionar un bloqueo de negocio (sin profesional asignado), ENTONCES EL SISTEMA responde como si no existiera (salida 404).
- RF-33: SI un usuario con rol staff edita un turno propio reasignándolo a otro profesional, ENTONCES EL SISTEMA rechaza la edición (salida 403).
- RF-34: SI un usuario solicita ver, editar o cancelar un turno de otra cuenta, o (siendo staff) un turno de su cuenta asignado a otro profesional, ENTONCES EL SISTEMA responde como si el turno no existiera (salida 404), con cuerpo `{ "error": "not_found" }`.
- RF-35: EL SISTEMA reserva la salida 403 para acciones vedadas por rol sobre recursos dentro del alcance del usuario (por ejemplo, staff intentando una acción exclusiva de owner); un recurso fuera de alcance siempre responde 404.

### Listar y ver

- RF-36: CUANDO un usuario autenticado solicita el listado, EL SISTEMA devuelve los turnos de su cuenta ordenados por fecha/hora de inicio ascendente; cada elemento incluye el turno y datos resumidos de cliente (id, nombre, email, teléfono), servicio (id, nombre, duración, precio) y profesional (id, nombre).
- RF-37: DONDE la solicitud de listado incluye filtros de estado (parámetro `status`, o su alias `type`), fecha desde, fecha hasta y/o profesional, EL SISTEMA devuelve solo los turnos que cumplen todos los filtros indicados.
- RF-38: EL SISTEMA aplica los filtros de fecha desde y fecha hasta sobre la fecha/hora de inicio del turno, interpretados en ISO 8601.
- RF-39: SI un filtro de fecha del listado no es un instante válido en ISO 8601, ENTONCES EL SISTEMA rechaza la solicitud (salida 400).
- RF-40: CUANDO ningún turno cumple los filtros, o cuando la fecha desde es posterior a la fecha hasta, EL SISTEMA devuelve una lista vacía (salida 200) sin error.
- RF-41: EL SISTEMA devuelve como máximo 500 turnos por respuesta de listado.
- RF-42: MIENTRAS el usuario tiene rol staff, EL SISTEMA fuerza el filtro de profesional a su propio id e ignora cualquier otro valor recibido.
- RF-43: CUANDO un usuario autenticado solicita un turno por id, EL SISTEMA lo devuelve con los mismos datos resumidos de RF-36, sujeto a RF-34.

### Baja

- RF-44: CUANDO un usuario autorizado cancela un turno en estado `agendado`, EL SISTEMA cambia su estado a `cancelado`, conserva la fila y devuelve el turno (salida 200).
- RF-45: SI se intenta cancelar, con la acción de cancelar turno, uno que no está en estado `agendado` (incluido `bloqueado`), ENTONCES EL SISTEMA rechaza la operación (salida 422).
- RF-46: CUANDO un usuario autorizado cancela un bloqueo (turno en estado `bloqueado`), EL SISTEMA cambia su estado a `cancelado` y conserva la fila (salida 200); no se borra ninguna fila físicamente.
- RF-47: SI el bloqueo a cancelar no existe, ENTONCES EL SISTEMA responde 404; SI ya está en estado `cancelado`, ENTONCES EL SISTEMA responde 422.
- RF-48: SI un usuario con rol staff intenta cancelar un bloqueo asignado a otro profesional o un bloqueo de negocio, ENTONCES EL SISTEMA responde como si no existiera (salida 404).

## Requisitos no funcionales

- Toda operación exige un JWT válido. La **identidad del actor** (cuenta, rol, id de usuario) se toma del token, nunca del cuerpo ni de la query; los **parámetros de filtrado** del listado sí viajan por query string.
- Los instantes se manejan en UTC, expresados en ISO 8601 con offset. "Momento actual" es la hora del servidor en UTC.
- Concurrencia: "última escritura gana". Cada operación revalida estado y solapamiento dentro de su transacción; el trigger de solapamiento de la DB es la salvaguarda final. No hay bloqueo optimista.
- Formato de error uniforme con el resto de la API: `{ "error": "<código>" }`.
- Idioma de mensajes y documentación: español.

## Notas de arquitectura

- RF-23 (solo `agendado` es editable) es una regla de transición de estado: vive en la máquina de estados del dominio, no en la DB.
- RF-34 (aislamiento por cuenta, y por profesional para staff) se implementa filtrando por `account_id` —y por `assigned_user_id`— en cada consulta. Es una decisión consciente; un refuerzo por RLS en Postgres queda como mejora futura.
- Toda operación multi-tabla (crear en `completado` más su pago; cambio de precio más historial) va en una única transacción (constitución, principio 4).

## Casos límite

- Crear con fin ya pasado → el turno nace `completado` y su pago se registra en la misma transacción (RF-9); si el pago falla, no se crea nada.
- Crear con inicio pasado pero fin futuro → nace `agendado` normal.
- Cambiar el servicio por uno más largo que hace que el nuevo fin pise el turno siguiente → 409, sin cambios (RF-29).
- Reasignar a un profesional que ya tiene un turno solapado → 409, sin cambios.
- Editar enviando solo campos no editables → 400 (RF-22); cuerpo de edición vacío → 400 (RF-21).
- Cancelar un turno ya `cancelado` → 422; cancelar un `bloqueado` con la acción de cancelar turno → 422 (RF-45).
- staff que pasa otro profesional al crear → el turno queda a su nombre (RF-16); staff que reasigna su turno a otro → 403 (RF-33).
- Turno o bloqueo de otra cuenta, en cualquier operación → 404.
- Autoasignación sin ningún profesional disponible → 409 (RF-7).
- Servicio con duración 0 o negativa → 422 (RF-12).
- Listado de una cuenta nueva → `[]`; fecha desde posterior a fecha hasta → `[]`.

## Fuera de alcance

- Reprogramación (cambiar la fecha/hora de inicio); el endpoint autenticado de reprogramar, si se necesita, es otra spec.
- Creación de bloqueos (`POST /block` ya existe); aquí solo se especifica su **cancelación**.
- Corrección `completado ↔ no_llego` (`/correct` ya existe).
- Notificar al cliente cuando su turno se crea o edita desde el panel.
- Historial / auditoría de cambios sobre un turno.
- Paginación del listado más allá del tope de 500 de RF-41.
- Detalle del cálculo de pago y comisión (spec de pagos); esta spec solo exige que el pago de RF-9 se registre en la misma transacción.

## Impacto fuera de la spec (se resuelve en el plan de implementación)

- Máquina de estados de `CLAUDE.md`: añadir la transición `bloqueado → cancelado` (hoy dice "no transiciona a nada") y eliminar el `DELETE` físico de `cancel-block`.
- Evaluar un `CHECK (duration_minutes > 0)` en `services` para respaldar RF-12 en la DB (constitución, principio 2).

## Criterios de finalización

- Cada RF con test automatizado. Se priorizan los casos no obvios sobre el CRUD trivial:
  1. Creación con fin pasado → estado `completado` más pago en la misma transacción; rollback si el pago falla (RF-9).
  2. Solapamiento provocado por cambio de servicio con fin desplazado y por reasignación de profesional (RF-25, RF-29).
  3. Precedencia de la regla de staff sobre el profesional recibido (RF-16); staff que reasigna a otro → 403 (RF-33).
  4. Autoasignación sin candidato → 409 (RF-7); bloqueo de negocio que impide crear o editar (RF-10, RF-29).
  5. Campo no editable en el cuerpo de edición → 400 (RF-22); semántica de `null` en `notes` (RF-20).
  6. Aislamiento por cuenta y por profesional → 404, nunca 403 para un recurso fuera de alcance (RF-34, RF-35).
  7. Adyacencia exacta (fin igual a inicio) no cuenta como solapamiento.
- `npm test` y `npm run db:migrate` en verde sobre una DB vacía.
- Demo manual: crear un turno con fin pasado y verificar su pago → crear uno futuro con profesional fuera de su horario (RF-5) → editar su servicio y verificar el nuevo fin → reasignarlo a un profesional con choque (409) → intentar editarlo tras pasar a `en_progreso` (422) → repetir como staff sobre un turno ajeno (404).

## Dudas abiertas

- Ninguna. Las cinco de la primera redacción (D1–D5) y las cuatro del triage de QA (T1–T4) están resueltas; ver "Registro de decisiones".

## Registro de decisiones

- **D1** — La autoasignación del panel sin profesional indicado mantiene la lógica del booking público: respeta la disponibilidad horaria (RF-6). Solo un profesional indicado explícitamente (RF-5) saltea esa validación.
- **D2** — Se acepta el registro a posteriori de turnos ya ocurridos (H2). El estado inicial resultante lo define T3.
- **D3** — Un `staff` que envía otro profesional al crear queda asignado a sí mismo en silencio (RF-16), igual que `POST /block`. No se responde 403.
- **D4** — La baja responde 404 a un `staff` que actúa sobre un turno o bloqueo ajeno (RF-34, RF-48). Coincide con el principio 6 de la constitución.
- **D5** — El listado conserva el parámetro `type` como alias de `status` (RF-37), aun sin uso propio actual, para no cerrar la puerta a un filtro por tipo en el futuro.
- **T1** — Al crear desde el panel, el cliente se indica por `client_id` existente o por datos de un cliente nuevo (find-or-create por email o teléfono), igual que el booking público (RF-1, RF-3).
- **T2** — Cambiar el servicio de un turno `agendado` es una edición in-place: el inicio no se mueve, el fin se recalcula y se revalida el solapamiento (RF-25, RF-29). No se trata como reprogramación pese a que desplaza el fin.
- **T3** — Un turno cuya fecha/hora de fin ya pasó nace directamente en estado `completado` y registra el pago en la misma transacción (RF-9). Solo los turnos con fin futuro nacen `agendado`. Reemplaza el enfoque "nace `agendado` y lo completa el cron" que se había aceptado en D2.
- **T4** — Cancelar un bloqueo pasa a baja lógica: `status = 'cancelado'`, sin `DELETE` físico (RF-46). Honra el principio 5 de la constitución sin enmendarla; implica añadir `bloqueado → cancelado` a la máquina de estados.
