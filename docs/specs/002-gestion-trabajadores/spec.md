# Spec 002 — Gestión de trabajadores (staff)

## Contexto y objetivo

El rol `staff` ya existe en el modelo de autorización de la plataforma, pero
hoy no hay forma de crear, editar, listar ni dar de baja usuarios con ese rol
desde el panel: los trabajadores solo pueden existir si se insertan a mano en
la base. Esta spec define cómo el owner incorpora, mantiene y da de baja al
equipo de profesionales de su cuenta —incluida la comisión propia de cada
uno, que ya usa el cálculo de pagos— y cómo un trabajador recién incorporado
obtiene acceso al sistema.

## Usuarios / actores

- **Owner**: dueño de la cuenta. Da de alta, edita, da de baja y lista
  trabajadores; también puede editar su propio perfil.
- **Staff (trabajador)**: profesional de la cuenta. Puede editar su propio
  perfil y activa su acceso mediante una invitación.

## Glosario

- **Trabajador**: usuario con rol `staff` de una cuenta. El owner de la
  cuenta no es un "trabajador" a los efectos de las operaciones de alta,
  edición por parte de un tercero, baja y listado de esta spec.
- **Estado de un trabajador**: `pendiente` (invitado, todavía sin
  contraseña utilizable), `activo` (activó su cuenta y puede loguearse) o
  `inactivo` (dado de baja; conserva la fila, nunca `DELETE` físico —
  constitución, principio 5).
- **Invitación**: enlace de un solo uso, con expiración, que permite a un
  trabajador `pendiente` definir su contraseña y pasar a `activo`.
- **Comisión propia**: porcentaje que, cuando está definido (no `null`) en
  el trabajador, tiene prioridad sobre la comisión de la cuenta al liquidar
  un pago (regla ya existente en el cálculo de comisiones).

## Historias de usuario

- H1: Como owner quiero invitar a un trabajador nuevo indicando sus datos
  para incorporarlo al equipo sin definirle yo la contraseña.
- H2: Como trabajador invitado quiero definir mi propia contraseña desde el
  enlace recibido para poder acceder al panel.
- H3: Como owner quiero editar los datos de cualquier trabajador de mi
  cuenta para corregir errores o actualizar información.
- H4: Como usuario autenticado (owner o staff) quiero editar mi propio
  nombre y contraseña para mantener mi perfil actualizado.
- H5: Como owner quiero dar de baja a un trabajador que deja el negocio
  para que pierda el acceso de inmediato y no se le sigan asignando turnos.
- H6: Como owner quiero ver la lista de trabajadores de mi cuenta, en
  cualquier estado, para tener visión del equipo.
- H7: Como owner quiero que invitar de nuevo al mismo email (ya invitado o
  ya dado de baja) resuelva la situación automáticamente, sin tener que
  usar una acción distinta según el caso.
- H8: Como owner quiero fijar o cambiar la comisión propia de un
  trabajador para que sus liquidaciones no dependan de la comisión general
  de la cuenta.

## Requisitos funcionales (criterios de aceptación en EARS)

### Invitar / alta

- RF-1: CUANDO el owner solicita crear un trabajador indicando nombre y
  email, EL SISTEMA crea el usuario en estado `pendiente`, genera un
  enlace de invitación de un solo uso y lo envía al email indicado, todo
  dentro de la misma transacción (salida 201).
- RF-2: EL SISTEMA asigna rol `staff` a todo trabajador creado por esta
  vía.
- RF-3: DONDE la solicitud de alta indica una comisión (`commission_rate`)
  distinta de `null`, EL SISTEMA la guarda como la comisión propia del
  trabajador; si se omite o se indica `null`, el trabajador queda sin
  comisión propia y sus liquidaciones usan la comisión de la cuenta.
- RF-4: SI la comisión indicada, al crear o editar, es un valor no nulo
  fuera del rango [0, 1], ENTONCES EL SISTEMA rechaza la operación (salida
  422) sin crear ni modificar nada; `null` nunca se considera un valor
  fuera de rango.
- RF-5: SI la solicitud de alta no incluye nombre o email, ENTONCES EL
  SISTEMA la rechaza (salida 400) sin crear nada.
- RF-6: SI el email indicado ya pertenece a un usuario `activo` (de esta
  cuenta o de cualquier otra), o a un usuario `pendiente` o `inactivo` de
  OTRA cuenta, ENTONCES EL SISTEMA rechaza el alta (salida 409) sin crear
  ni enviar nada.
- RF-7: SI el email indicado pertenece a un trabajador `inactivo` de la
  MISMA cuenta, ENTONCES EL SISTEMA lo reactiva a estado `pendiente` con
  los datos recibidos en lugar de crear uno nuevo, y genera una nueva
  invitación (salida 200).
- RF-8: SI el email indicado pertenece a un trabajador `pendiente` de la
  MISMA cuenta, ENTONCES EL SISTEMA actualiza sus datos con los recibidos,
  invalida cualquier enlace de invitación anterior, genera uno nuevo y lo
  envía (salida 200), igual que un reenvío explícito.
- RF-9: EL SISTEMA fija la expiración del enlace de invitación en 72 horas
  desde su emisión.
- RF-10: SI se intenta usar un enlace de invitación vencido o ya
  utilizado, ENTONCES EL SISTEMA rechaza la definición de contraseña
  (salida 410) sin activar la cuenta.
- RF-11: CUANDO el trabajador define su contraseña a través de un enlace
  de invitación válido, EL SISTEMA la guarda, pasa el usuario a estado
  `activo` e invalida el enlace para que no pueda reutilizarse (salida
  200).
- RF-12: CUANDO el owner solicita reenviar la invitación a un trabajador
  `pendiente`, EL SISTEMA invalida cualquier enlace anterior emitido para
  ese trabajador, genera uno nuevo y lo envía (salida 200).
- RF-13: SI se solicita reenviar la invitación a un trabajador que no está
  en estado `pendiente`, ENTONCES EL SISTEMA rechaza la solicitud (salida
  422).
- RF-14: SI un usuario con rol staff solicita crear un trabajador,
  ENTONCES EL SISTEMA rechaza la solicitud (salida 403).
- RF-15: SI falla el envío del email de invitación (alta, reactivación,
  reenvío automático de RF-8, reenvío explícito o reemisión por cambio de
  email), ENTONCES EL SISTEMA revierte cualquier escritura asociada; no
  queda creado ni modificado ningún registro.

### Editar

- RF-16: CUANDO el owner edita los datos de un trabajador `pendiente` o
  `activo` de su cuenta, EL SISTEMA aplica los cambios recibidos sobre
  nombre, email y/o comisión propia, y devuelve el trabajador actualizado
  (salida 200).
- RF-17: SI se intenta editar a un trabajador `inactivo`, ENTONCES EL
  SISTEMA rechaza la edición (salida 422); reincorporarlo requiere una
  nueva invitación (RF-7).
- RF-18: CUANDO la edición de un trabajador `pendiente` cambia su email,
  EL SISTEMA invalida el enlace de invitación anterior, genera uno nuevo
  al email actualizado y lo envía, dentro de la misma transacción que la
  edición.
- RF-19: EL SISTEMA permite fijar la comisión propia en `null` para que el
  trabajador vuelva a depender de la comisión de la cuenta.
- RF-20: CUANDO un usuario autenticado (owner o staff) edita su propio
  perfil, EL SISTEMA le permite modificar nombre y contraseña.
- RF-21: SI un usuario intenta modificar, en su propio perfil, el email,
  el rol o la comisión propia, ENTONCES EL SISTEMA rechaza la edición
  (salida 400).
- RF-22: SI la edición de un trabajador (por el owner) cambia el email a
  uno que ya pertenece a cualquier otro usuario existente en cualquier
  estado, ENTONCES EL SISTEMA rechaza la edición (salida 409) sin
  modificar la fila; a diferencia del alta, la edición nunca reactiva ni
  fusiona registros.
- RF-23: SI la solicitud de edición no incluye ningún campo editable,
  ENTONCES EL SISTEMA la rechaza (salida 400) sin modificar la fila.
- RF-24: SI un staff intenta editar los datos de otro trabajador, ENTONCES
  EL SISTEMA responde como si ese trabajador no existiera (salida 404).

### Baja

- RF-25: CUANDO el owner da de baja a un trabajador `activo` o
  `pendiente` de su cuenta, EL SISTEMA lo marca `inactivo`, revoca su
  acceso y conserva la fila (salida 200); no hay `DELETE` físico.
- RF-26: CUANDO se da de baja a un trabajador, EL SISTEMA cancela, dentro
  de la misma transacción, todos los turnos en estado `agendado` y todos
  los bloqueos con fecha/hora de inicio futura asignados a ese trabajador.
- RF-27: EL SISTEMA no modifica turnos en estado `completado`, `no_llego`
  o `cancelado` al dar de baja al trabajador asignado.
- RF-28: SI se intenta dar de baja a un trabajador que ya está `inactivo`,
  ENTONCES EL SISTEMA rechaza la operación (salida 422).
- RF-29: SI un staff intenta dar de baja a un trabajador, sea a sí mismo o
  a otro, ENTONCES EL SISTEMA rechaza la solicitud (salida 403).
- RF-30: EL SISTEMA valida, en cada solicitud autenticada de cualquier
  ruta de la plataforma, que el usuario referenciado por el JWT siga
  `activo`; SI no lo está, ENTONCES rechaza la solicitud (salida 401), sin
  esperar a que el token expire por su cuenta.

### Listar y ver

- RF-31: CUANDO el owner solicita el listado de trabajadores, EL SISTEMA
  devuelve los trabajadores de su cuenta en cualquier estado (`pendiente`,
  `activo`, `inactivo`), ordenados alfabéticamente por nombre, con nombre,
  email, rol, comisión propia y estado.
- RF-32: DONDE la solicitud de listado incluye un filtro de estado, EL
  SISTEMA devuelve solo los trabajadores que lo cumplen.
- RF-33: SI un staff solicita el listado de trabajadores, ENTONCES EL
  SISTEMA rechaza la solicitud (salida 403).

### Alcance por cuenta

- RF-34: SI se solicita ver, editar o dar de baja un trabajador que no
  pertenece a la cuenta del usuario autenticado, ENTONCES EL SISTEMA
  responde como si no existiera (salida 404).

## Requisitos no funcionales

- Toda operación exige JWT válido y que el usuario referenciado por el JWT
  siga `activo` (RF-30), salvo la definición de contraseña vía enlace de
  invitación, que se autentica con el token de invitación (no JWT),
  siguiendo el mismo patrón que los enlaces de autogestión del cliente.
- La identidad del actor (cuenta, rol, id) sale siempre del JWT, nunca del
  body ni de la query.
- La comparación de email para detectar duplicados (alta, reactivación,
  reenvío automático, edición) es case-insensitive, reutilizando la
  normalización ya usada en registro y login (`normalizeEmail`).
- Concurrencia: "última escritura gana". Cada operación revalida el estado
  (`pendiente`/`activo`/`inactivo`) del trabajador dentro de su propia
  transacción antes de aplicar el cambio; no hay bloqueo optimista.
- El contenido y la plantilla del email de invitación quedan fuera de esta
  spec; solo se exige que el envío ocurra y que el enlace sea válido según
  RF-9 y RF-10.
- Formato de error uniforme con el resto de la API: `{ "error": "<código>" }`.
- Idioma de mensajes y documentación: español.

## Casos límite

- Invitar con un email que ya es owner de otra cuenta → 409 (RF-6).
- Invitar de nuevo al mismo email mientras sigue `pendiente` en la misma
  cuenta → reenvía automáticamente en lugar de fallar (RF-8).
- Reenviar explícitamente la invitación a alguien que ya activó su cuenta,
  o que está `inactivo` → 422 (RF-13).
- Usar un enlace de invitación dos veces → 410 la segunda vez, porque la
  primera lo invalida (RF-10, RF-11).
- Editar el email de un trabajador `pendiente` → reemite la invitación al
  nuevo email e invalida la anterior (RF-18).
- Editar a un trabajador `inactivo` → 422; la única vía para reincorporarlo
  es una nueva invitación al mismo email (RF-17, RF-7).
- Editar el email de un trabajador para que coincida con el de otro
  trabajador `inactivo` de la misma cuenta → 409, la edición nunca
  reactiva (RF-22, a diferencia de RF-7 en el alta).
- Email de un usuario `inactivo` de otra cuenta → sigue bloqueado, no se
  libera (RF-6).
- Dar de baja a un trabajador con turnos y bloqueos futuros → ambos se
  cancelan en cascada (RF-26); lo ya pasado queda intacto (RF-27).
- Dar de baja a un trabajador ya `inactivo` → 422 (RF-28).
- Un trabajador con sesión activa (JWT vigente) es dado de baja → pierde
  el acceso en su siguiente request, no recién cuando expire el token
  (RF-30).
- Staff que intenta ver o editar a un compañero → 404 (RF-24); staff que
  intenta invitar, dar de baja (a otro o a sí mismo) o listar el equipo →
  403 (RF-14, RF-29, RF-33).
- Staff u owner que intenta cambiar su propio email, rol o comisión desde
  la edición de perfil propio → 400 (RF-21).
- Comisión fuera de [0, 1] (por ejemplo, `1.5` o `-0.1`) al crear o editar
  → 422 (RF-4); `null` explícito siempre es válido y limpia la comisión
  propia (RF-3, RF-19).
- Falla el envío del email en cualquier flujo de invitación → no queda
  nada creado ni modificado (RF-15).
- Trabajador de otra cuenta, en cualquier operación → 404 (RF-34).

## Fuera de alcance

- Alta de un segundo owner o cambio de rol entre `owner` y `staff`.
- El owner dándose de baja a sí mismo o eliminando la cuenta.
- Baja de la propia cuenta por parte de un staff (renuncia): la baja es
  siempre una acción exclusiva del owner, sin excepción (RF-29).
- Gestión de disponibilidad semanal del trabajador (`availability`) — ya
  tiene sus propias rutas.
- Recalcular o corregir pagos ya liquidados cuando cambia la comisión
  propia de un trabajador; el cambio solo aplica hacia adelante.
- Contenido/plantilla del email de invitación.
- Recuperación de contraseña por olvido (distinto del flujo de activación
  por invitación).
- Historial/auditoría de cambios sobre un trabajador.

## Notas de arquitectura

- RF-4 (rango [0, 1] de la comisión propia) se refuerza con un `CHECK` en
  la tabla `users` (constitución, principio 2), igual que el `CHECK` de
  duración positiva ya existente en `services`.
- La unicidad de email entre RF-6, RF-7, RF-8 y RF-34 se apoya en el
  índice único ya existente en `users.email`, que no distingue estado
  (`pendiente`/`activo`/`inactivo`) — es la misma invariante de "email
  único en toda la plataforma" ya fijada para el proyecto.
- RF-17 (solo `pendiente`/`activo` son editables) y RF-22 (la edición
  nunca reactiva) son reglas de transición de estado: viven en el dominio,
  no en la DB, igual que el criterio usado en la spec 001 para el estado
  de los turnos.
- Toda operación multi-tabla (alta + token + envío; baja + cancelación en
  cascada de turnos y bloqueos) va en una única transacción (constitución,
  principio 4); el envío de email se trata como parte de esa operación
  (RF-15), no como un efecto secundario best-effort.

## Impacto fuera de esta spec (se resuelve en el plan de implementación)

- El middleware de autenticación JWT, usado por toda la plataforma (no
  solo por las rutas de esta spec), debe empezar a validar en cada request
  que el usuario siga `activo` (RF-30); hoy no lo hace.
- `POST /auth/login` debe rechazar a un usuario que no esté `activo`
  (`pendiente` no tiene contraseña utilizable; `inactivo` no debe poder
  loguearse) — hoy no filtra por estado.
- El modelo de `users` necesita representar el estado (`pendiente` /
  `activo` / `inactivo`) y admitir password_hash no utilizable mientras
  está `pendiente`; hoy `password_hash` es obligatorio desde la creación
  de la fila.

## Criterios de finalización

- Cada RF con test automatizado. Se priorizan los casos no obvios sobre el
  CRUD trivial:
  1. Invitación → activación por token → login funcional (RF-1, RF-11).
  2. Enlace vencido o reutilizado → 410 (RF-10).
  3. Reinvitar a un `pendiente` de la misma cuenta reenvía automáticamente
     (RF-8); reenviar explícitamente a alguien ya activo o inactivo → 422
     (RF-13).
  4. Email duplicado activo/pendiente/inactivo de otra cuenta (409) vs.
     reactivación de un inactivo de la misma cuenta (200) vs. la edición,
     que nunca reactiva (RF-6, RF-7, RF-22).
  5. Comisión propia: guardado al crear/editar, límites [0, 1] con `null`
     como excepción explícita, y limpieza con `null` (RF-3, RF-4, RF-19);
     nadie puede tocar su propia comisión desde el autoedición (RF-21).
  6. Baja cancela en cascada turnos `agendado` y bloqueos futuros, en la
     misma transacción; lo ya pasado queda intacto (RF-26, RF-27).
  7. Un usuario dado de baja pierde el acceso en la siguiente request, no
     al expirar el JWT (RF-30).
  8. 403 para un staff que intenta invitar, dar de baja o listar (RF-14,
     RF-29, RF-33); 404 para un staff que intenta ver/editar a otro
     trabajador o a uno de otra cuenta (RF-24, RF-34).
  9. Falla de envío de invitación no deja nada a medio crear (RF-15).
- `npm test` y `npm run db:migrate` en verde sobre una DB vacía.
- Demo manual: invitar un trabajador con comisión propia → activar cuenta
  desde el enlace → loguearse → owner edita su nombre y le cambia la
  comisión → staff edita su propia contraseña → owner lo da de baja
  teniendo un turno y un bloqueo futuro asignados (ambos se cancelan) →
  intentar loguearse con su sesión previa (rechazado) → reinvitar al mismo
  email (reactiva).

## Dudas abiertas

- Ninguna.

## Registro de decisiones

- **D1** — CRUD completo (alta, edición, baja, listado), no solo alta.
- **D2** — El owner edita a cualquier trabajador; cualquier usuario
  (owner o staff) edita su propio perfil (nombre y contraseña).
- **D3** — El alta es por invitación con enlace: el owner no define la
  contraseña del trabajador directamente.
- **D4** — El enlace de invitación expira a las 72 horas y es reenviable
  (RF-9, RF-12).
- **D5** — Email duplicado en el alta: `activo` en cualquier cuenta → 409;
  `pendiente` o `inactivo` de OTRA cuenta → 409 (el email sigue reservado
  globalmente, no se libera); `inactivo` de la MISMA cuenta → reactiva;
  `pendiente` de la MISMA cuenta → reenvía automáticamente (RF-6, RF-7,
  RF-8).
- **D6** — La reactivación/reenvío automático por email coincidente es
  exclusiva del alta; la edición nunca reactiva ni fusiona registros,
  siempre rechaza con 409 (RF-22).
- **D7** — Dar de baja a un trabajador cancela en cascada sus turnos
  futuros `agendado` y sus bloqueos futuros, en la misma transacción
  (RF-26).
- **D8** — La comisión propia del trabajador (`commission_rate`) se
  gestiona en esta spec; `null` es siempre válido y distinto de "fuera de
  rango" (RF-3, RF-4, RF-19).
- **D9** — La baja "revoca el acceso" de forma efectiva: cada request
  valida que el usuario siga `activo` contra la base, no solo la validez
  del JWT (RF-30). Esto cambia el middleware de autenticación global de la
  plataforma (ver "Impacto fuera de esta spec").
- **D10** — Las acciones exclusivas del owner (alta, baja, listado)
  responden 403 explícito a un staff; ver/editar un trabajador puntual
  fuera del alcance de un staff responde 404, igual que el criterio ya
  usado en la spec 001.
