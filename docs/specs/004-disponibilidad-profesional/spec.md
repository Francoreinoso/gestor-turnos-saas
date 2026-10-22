# Spec 004 — Disponibilidad semanal del profesional

## Contexto y objetivo

La tabla `availability` (ventanas semanales por profesional) alimenta el cálculo
de horarios libres (`GET /availability/:business_id`) y la autoasignación de
profesional (`findAvailableProfessional`). Hoy **nada la escribe**: no existe
ninguna ruta para definir, ver o cambiar el horario de un profesional, así que
un negocio recién creado nunca ofrece horarios y el booking público queda
inutilizable sin tocar la base a mano. La spec 002 dejó esto fuera de alcance
("ya tiene sus propias rutas"), pero esas rutas solo calculan slots.
Esta spec define cómo el owner y cada profesional consultan y reemplazan su
horario semanal, y corrige que el cálculo de slots considere a profesionales
dados de baja.

## Usuarios / actores

- **Owner**: gestor del negocio. No atiende turnos, por lo que no tiene horario propio; define y consulta el horario de cualquier trabajador de su cuenta.
- **Staff**: profesional. Consulta y define únicamente su propio horario.
- **Cliente (público)**: no gestiona nada; consume el resultado vía el cálculo de slots existente.

## Glosario

- **Trabajador**: usuario con rol `staff`. El owner no es un trabajador a efectos de esta spec (no tiene turnos ni horario).
- **Ventana**: franja semanal recurrente `{ day_of_week, start_time, end_time }` de un profesional. `day_of_week`: 0 = domingo … 6 = sábado (convención de `Date.getDay()`, la que ya usa el cálculo de slots).
- **Horario semanal**: conjunto completo de ventanas de un profesional. Es la unidad que se lee y se escribe: se **reemplaza entero**, no se edita ventana a ventana.
- **Hora de pared**: `HH:MM` sin zona horaria, interpretada igual que hoy en el cálculo de slots. El manejo de zonas horarias queda fuera de alcance.
- **Solapamiento de ventanas**: dos ventanas del mismo profesional y mismo día con `a.start < b.end` y `b.start < a.end`. Ventanas adyacentes (fin = inicio) **no** se solapan.

## Historias de usuario

- H1: Como owner quiero definir el horario semanal de cada profesional para que el negocio empiece a ofrecer turnos.
- H2: Como staff quiero ajustar mi propio horario sin pedírselo al owner.
- H3: Como owner quiero ver el horario actual de un profesional antes de cambiarlo.
- H4: Como cliente no quiero que me ofrezcan horarios de un profesional que ya no trabaja en el negocio.

## Requisitos funcionales (criterios de aceptación en EARS)

### Consultar

- RF-1: CUANDO un usuario autorizado solicita el horario de un trabajador de su cuenta, EL SISTEMA devuelve sus ventanas ordenadas por día y hora de inicio (salida 200); si no tiene ninguna, devuelve lista vacía.
- RF-2: EL SISTEMA devuelve cada ventana con `day_of_week`, `start_time` y `end_time` en formato `HH:MM` (la base guarda `HH:MM:SS`; la API normaliza la salida, sin alterar la comparación interna de `findAvailableProfessional`).

### Reemplazar el horario semanal

- RF-3: CUANDO un usuario autorizado envía una lista de ventanas para un trabajador, EL SISTEMA reemplaza todas sus ventanas por las recibidas en una sola transacción y devuelve el horario resultante (salida 200).
- RF-4: EL SISTEMA acepta una lista vacía y, en ese caso, deja al trabajador sin ventanas (no es ofrecido en el cálculo de slots).
- RF-5: SI el cuerpo no es una lista, o alguna ventana no es un objeto o omite `day_of_week`, `start_time` o `end_time`, ENTONCES EL SISTEMA rechaza la solicitud (salida 400) sin modificar nada. Es un error de **forma**.
- RF-6: SI `day_of_week` está presente pero no es un entero entre 0 y 6 (incluye texto o decimales), ENTONCES EL SISTEMA rechaza la solicitud (salida 422) sin modificar nada. Es un error de **valor**.
- RF-7: SI `start_time` o `end_time` están presentes pero no tienen formato `HH:MM` válido (00:00–23:59), ENTONCES EL SISTEMA rechaza la solicitud (salida 422) sin modificar nada.
- RF-8: SI en alguna ventana `start_time` es mayor o igual a `end_time`, ENTONCES EL SISTEMA rechaza la solicitud (salida 422) sin modificar nada. Las ventanas que cruzan medianoche no se admiten: se expresan como dos ventanas en días consecutivos.
- RF-9: SI dos ventanas de la lista se solapan en el mismo día (incluidas ventanas idénticas repetidas), ENTONCES EL SISTEMA rechaza la solicitud (salida 422) sin modificar nada.
- RF-10: EL SISTEMA evalúa en este orden y responde con el primer fallo: autenticación (401) → existencia y alcance del trabajador (404) → estado del trabajador (RF-11, 422) → forma del cuerpo (RF-5, 400) → valores (RF-6 a RF-9, 422). Así un 400/422 nunca revela la existencia de un trabajador fuera de alcance.
- RF-11: SI el trabajador está `inactivo`, ENTONCES EL SISTEMA rechaza el reemplazo (salida 422); los trabajadores `pendiente` y `activo` sí se pueden configurar, de modo que el owner prepara el horario antes de que el invitado active su cuenta.
- RF-12: EL SISTEMA no valida el horario contra turnos ya agendados: cambiar el horario **no** cancela ni mueve turnos existentes (solo afecta a los slots que se ofrezcan hacia adelante).

### Alcance por rol

- RF-13: MIENTRAS el usuario tiene rol owner, EL SISTEMA le permite consultar y reemplazar el horario de cualquier trabajador (rol `staff`) de su cuenta.
- RF-14: MIENTRAS el usuario tiene rol staff, EL SISTEMA le permite consultar y reemplazar únicamente su propio horario.
- RF-15: SI un usuario solicita el horario de un usuario que no es un trabajador de su cuenta (otra cuenta, el id de un owner, o inexistente), o (siendo staff) el de otro trabajador de su cuenta, ENTONCES EL SISTEMA responde como si el trabajador no existiera (salida 404, `{ "error": "not_found" }`). Es la misma política que el detalle de trabajadores (spec 002 RF-34).
- RF-16: EL SISTEMA reserva la salida 403 para acciones vedadas por rol sobre recursos dentro del alcance; esta spec no define ninguna, por lo que no emite 403.

### Efecto sobre el cálculo de slots

- RF-17: CUANDO se calculan los horarios libres (`GET /availability/:business_id`) o se autoasigna un profesional (`findAvailableProfessional`), EL SISTEMA considera únicamente a usuarios con rol `staff` y estado `activo`; los `pendiente`, los `inactivo` y el owner no se ofrecen. Ambos caminos comparten `userRepo.findWithAvailability`, que es donde se aplica el filtro.
- RF-18: CUANDO un horario semanal es reemplazado, EL SISTEMA refleja el nuevo horario en el siguiente cálculo de slots, sin caché intermedia.

## Requisitos no funcionales

- Concurrencia: dos reemplazos simultáneos del mismo horario se serializan en la transacción; gana el último en confirmar y nunca queda una mezcla de ambos.
- Toda operación exige un JWT válido; la identidad (cuenta, rol, id) sale del token, nunca del cuerpo ni de la query (constitución, principio 6).
- Reemplazo atómico: borrar las ventanas viejas e insertar las nuevas ocurre en una sola transacción; ante cualquier fallo queda el horario anterior intacto (principio 4).
- Formato de error uniforme: `{ "error": "<código>" }`.
- Idioma de mensajes y documentación: español.

## Notas de arquitectura

- Reglas puras de validación de ventanas (rango de día, formato, orden, solapamiento) → `domain/` (principio 3). El caso de uso orquesta alcance por rol, estado del trabajador y transacción.
- Invariantes en la base (principio 2): `CHECK (day_of_week BETWEEN 0 AND 6)` y `CHECK (start_time < end_time)` en `availability`. El no-solapamiento entre ventanas del mismo usuario/día se decide en el plan (exclusion constraint con `btree_gist` vs. validación del reemplazo completo dentro de la transacción).
- Ruta por recurso del trabajador: `GET|PUT /staff/:id/availability`, junto al resto de rutas de `staff`. `PUT` (reemplazo total e idempotente) en lugar de `PATCH`, porque el cuerpo es el estado final completo; no hay acción parcial que exponer (principio 7).
- RF-17 corrige `userRepo.findWithAvailability`, que hoy no filtra por estado.

## Casos límite

- Lista vacía → el trabajador queda sin ventanas y deja de aparecer en slots (RF-4).
- Dos tramos el mismo día (mañana y tarde) → válidos si no se solapan (ej. 09:00–13:00 y 15:00–19:00).
- Ventanas adyacentes (09:00–13:00 y 13:00–17:00) → válidas (no solapan).
- `end_time` 24:00 → inválido (RF-7); para llegar a fin de día se usa 23:59.
- Staff intentando editar a un compañero → 404 (RF-15); owner editando a un `inactivo` → 422 (RF-11).
- `PUT /staff/<id del owner>/availability` → 404 (RF-15); el owner no tiene horario.
- Staff de otra cuenta con cuerpo inválido → 404, no 400/422 (RF-10).
- `day_of_week: "1"` (texto) → 422 (RF-6); `{ day_of_week: 1 }` sin horas → 400 (RF-5).
- Reemplazo que falla a mitad (ej. violación de CHECK) → el horario anterior sigue vigente (RNF de atomicidad).
- Cambiar el horario con turnos ya agendados fuera de la nueva ventana → los turnos se mantienen (RF-12).

## Fuera de alcance

- Excepciones por fecha (feriados, vacaciones): el diseño original ya las posterga; se cubren con bloqueos (`POST /appointments/block`).
- Zonas horarias por negocio (se mantiene la interpretación actual de hora de pared).
- Editar ventanas individuales (alta/baja/modificación por ventana).
- Validar o reubicar turnos existentes al cambiar el horario.
- Pantallas del panel para editar el horario (spec 005).
- Asignar turnos al owner: se asume que el owner no atiende. Que la spec 001 (RF-14) permita pasar el id de un owner como profesional explícito es una inconsistencia ajena a esta spec; se anota para revisarla allí.

## Criterios de finalización

- Cada RF con test automatizado. Se priorizan los casos no obvios:
  1. Reemplazo atómico: un fallo a mitad conserva el horario previo (RF-3).
  2. Solapamiento dentro de la lista y adyacencia exacta (RF-9, RF-10 y caso límite).
  3. Alcance por rol: staff ajeno y otra cuenta → 404, nunca 403 (RF-15, RF-16).
  4. Trabajador `inactivo` → 422; `pendiente` → 200 (RF-11).
  5. Slots y autoasignación excluyen `pendiente`/`inactivo` y reflejan el reemplazo inmediato (RF-17, RF-18).
- `npm test` y `npm run db:migrate` en verde sobre una DB vacía.
- Demo manual: crear un owner → invitar y activar un staff → `PUT` de su horario → `GET /availability/:business_id` ofrece slots → vaciar el horario → ya no ofrece → intentar como otro staff → 404.

## Dudas abiertas

- Ninguna. Q1 y Q2 de la primera redacción están resueltas; ver D5 y D6.

## Registro de decisiones

- **D1** — El horario se reemplaza completo con `PUT`, no por ventana: simplifica validación (solapamiento sobre el conjunto final), atomicidad y UI (RF-3).
- **D2** — Solo `activo` se ofrece en slots (RF-17), pero `pendiente` se puede configurar de antemano (RF-11): el owner deja el horario listo antes de que el invitado active su cuenta.
- **D3** — El cambio de horario no toca turnos existentes (RF-12); cancelaciones masivas son decisión del negocio, no un efecto colateral.
- **D4** — Sin soporte de ventanas que crucen medianoche (RF-8): se parten en dos días, evitando ambigüedad de `day_of_week` y de solapamiento.
- **D5** — (Q1) El owner es solo gestor: no atiende turnos y no tiene horario. `/staff/:id/availability` solo resuelve usuarios con rol `staff` (RF-13, RF-15); no hace falta `/me/availability` para el owner. Si en el futuro el owner atiende, se reabre con una spec nueva.
- **D6** — (Q2) Sin tope de ventanas por trabajador (YAGNI): el único límite es la validación de solapamiento.
