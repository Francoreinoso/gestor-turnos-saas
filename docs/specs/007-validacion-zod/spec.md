# Spec 007 — Validación de entrada con Zod

## Contexto y objetivo

El backend valida la entrada HTTP a mano y de forma dispersa. Hay tres estilos
conviviendo: chequeos `if (!a || !b) throw httpErr(400, 'missing_fields')`
dentro de las rutas (`auth`, `public`, `appointments`, `services`, `clients`),
validadores de dominio con `typeof`/`Number.isNaN`/regex (`availabilityWindows`,
`staffEdit`, `client`, `paymentsPeriod`) y **ausencia de validación** en varios
campos que llegan al caso de uso o a Postgres sin chequear. Consecuencias:
las reglas de forma se repiten (`missing_fields` aparece en 12 sitios), no hay
un único lugar donde leer el contrato de cada endpoint, y un tipo inesperado
(`name: 123`, `email: {}`, `scheduled_at: []`) puede terminar en un 500.

Esta spec introduce **Zod** como único mecanismo de validación de **forma y
formato** de la entrada (body, query y params), con un esquema por endpoint.
Es un refactor de comportamiento observable casi nulo: los códigos de estado y
de error que hoy devuelve la API no cambian, salvo las correcciones de 500 → 4xx
listadas en RF-9. Las reglas de negocio (solapamientos, fechas pasadas,
alcance por rol, transiciones de estado) **no** se mueven a Zod.

**Justificación de la dependencia (constitución, principio 1):** Zod
declara el contrato de cada entrada en un solo lugar, rechaza tipos inesperados
de forma uniforme y es la librería de validación estándar del ecosistema Node;
sin ella habría que seguir ampliando validadores a mano, con el mismo riesgo
de huecos. Es una dependencia pura de JavaScript, sin I/O, compatible con
módulos ES y con la regla de capas puras (principio 3). Se agrega una sola
dependencia, solo al backend.

## Usuarios / actores

- **Cliente de la API** (frontend, integraciones, un revisor con `curl`): envía requests; necesita errores consistentes y predecibles.
- **Contribuidor**: añade o cambia endpoints; necesita un lugar único y declarativo donde definir qué entrada acepta cada uno.

## Glosario

- **Esquema**: definición Zod de la forma que debe tener el body, la query o los params de un endpoint.
- **Error de forma**: la entrada no tiene la estructura o el tipo esperado (falta un campo, un campo tiene el tipo equivocado, el body no es un objeto). Hoy responde **400**.
- **Error de valor**: la estructura es correcta pero un valor no cumple su regla (formato `HH:MM`, rango de `day_of_week`, orden inicio < fin). Hoy responde **422** donde la spec del endpoint así lo definió.
- **Código de error**: el string de `{ "error": "<código>" }`. Es parte del contrato público.
- **Capa de validación**: la función que aplica un esquema y traduce el primer fallo al código de error y estado HTTP que corresponde.

## Historias de usuario

- H1: Como contribuidor quiero declarar la entrada de un endpoint con un esquema, en vez de escribir `if`s en cada ruta.
- H2: Como cliente de la API quiero recibir siempre un 4xx con un código claro cuando mando algo mal formado, nunca un 500.
- H3: Como cliente de la API quiero que nada de lo que ya funcionaba cambie de respuesta.
- H4: Como revisor quiero poder leer los esquemas y entender el contrato de cada endpoint sin recorrer casos de uso.

## Requisitos funcionales (criterios de aceptación en EARS)

### Mecanismo

- RF-1: EL SISTEMA define la validación de forma y formato de body, query y params con esquemas Zod, uno por entrada de endpoint, ubicados en un único módulo de esquemas (sin I/O) y reutilizables desde los casos de uso.
- RF-2: CUANDO una entrada no cumple su esquema, EL SISTEMA responde con el estado y el código de error que ese caso devuelve hoy (RF-4 a RF-8), con el formato uniforme `{ "error": "<código>" }`. Nunca se expone el árbol de errores de Zod ni mensajes en inglés de la librería.
- RF-3: SI una entrada tiene varios fallos, ENTONCES EL SISTEMA responde con **uno solo**, determinista: el primero según el orden de los campos del esquema. Dos requests idénticas dan siempre el mismo código.

### Compatibilidad de respuestas

- RF-4: EL SISTEMA conserva los códigos de estado y de error existentes para toda entrada que hoy produce un 4xx por forma o formato (`missing_fields`, `invalid_body`, `invalid_window`, `invalid_day_of_week`, `invalid_time_format`, `invalid_phone_format`, `invalid_date`, `invalid_period`, `invalid_commission_rate`, `invalid_scheduled_at`, `client_required`, `email_or_phone_required`, entre otros). Un test de caracterización por código lo comprueba antes de migrar.
- RF-5: EL SISTEMA conserva la distinción **forma → 400, valor → 422** definida en la spec 004 (RF-5 a RF-9) para el horario semanal, y la aplica igual donde hoy exista.
- RF-6: EL SISTEMA conserva el **orden de evaluación** de cada endpoint. En particular, en `PUT /staff/:id/availability` (spec 004 RF-10) la forma del cuerpo se valida **después** de la autenticación, el alcance del trabajador (404) y su estado (422); un body inválido nunca revela la existencia de un trabajador fuera de alcance. Por eso la validación se invoca desde el caso de uso o desde un paso explícito en la ruta que respete ese orden, no como un middleware global que corra antes del chequeo de alcance.
- RF-7: EL SISTEMA no modifica ningún criterio de autorización (401/403/404), de transición de estado (422 `invalid_status_transition`), de conflicto (409) ni de existencia de recursos. Zod no decide sobre ellos.
- RF-8: EL SISTEMA conserva la validación de UUID en params que hoy responde 404 (`isUuid` → `not_found`, por la política de no revelar existencia, spec 005 RF-3/RF-7); el esquema de params no la convierte en 400.

### Correcciones de huecos

- RF-9: CUANDO un campo llega con un tipo incorrecto donde hoy no se valida (por ejemplo `name`, `email`, `password`, `business_name`, `notes`, `phone` que no son string; `duration_minutes` o `price` que no son número/decimal válidos; `scheduled_at` que no es string ISO; `employee_id`/`service_id`/`client_id` que no son UUID en el body), EL SISTEMA responde 400 con el código de error del campo (o `invalid_body` si no hay uno específico) en lugar de un 500 o de persistir un valor incorrecto. Esta es la **única** categoría de cambio de comportamiento observable.
- RF-10: SI el body de un endpoint que espera un objeto es `null`, un array, un string o está ausente, ENTONCES EL SISTEMA responde 400 `invalid_body`.
- RF-11: EL SISTEMA descarta los campos desconocidos del body sin error, para no romper a clientes existentes que envían campos de más; solo los campos declarados llegan al caso de uso. **Excepción (RF-4 prevalece):** los endpoints de edición que hoy rechazan campos desconocidos con 400 `invalid_field` (`PATCH /staff/:id`, `PATCH /me`, `PATCH /appointments/:id`) conservan ese rechazo y sus códigos `invalid_field` y `empty_update`.

### Normalización

- RF-12: EL SISTEMA aplica a través del esquema las normalizaciones que hoy hace en dispersión cuando son puramente de forma (recorte de espacios en `name`, `business_name` y `notes`; minúsculas en `email`). La normalización de email conserva el resultado actual de `normalizeEmail`.
- RF-13: EL SISTEMA mantiene los campos opcionales como opcionales: un `undefined` o la ausencia del campo sigue significando "no enviado" y no se convierte en `null` ni en cadena vacía.

### Alcance de cobertura

- RF-14: EL SISTEMA cubre con esquema **todos** los endpoints que reciben body, query o params con estructura: `auth` (register, login), `appointments` (crear, editar, bloquear, corregir, listar), `services` (crear, editar, precio, listar), `clients` (crear, editar), `accounts` (comisiones), `me`, `staff` (invitar, editar, horario, listar), `payments` (listar, resumen), `availability` (slots) y `public` (booking, reprogramar, activar cuenta).
- RF-15: EL SISTEMA elimina del código las validaciones manuales de forma que quedan cubiertas por un esquema (los `if (!x) throw httpErr(400, 'missing_fields')` de las rutas y los `typeof`/regex de los validadores de dominio equivalentes), sin dejar la misma regla en dos lugares.

## Requisitos no funcionales

- **Sin cambio de contrato:** ningún test de integración existente cambia su resultado esperado, salvo los añadidos para RF-9 y RF-10 (principio 9: suite verde antes y después).
- **Capas puras (principio 3):** los esquemas no hacen I/O ni importan infraestructura; Zod solo se importa en el módulo de esquemas y en la capa de validación.
- **Un solo formato de error:** `{ "error": "<código>" }`, igual que hoy.
- **Rendimiento:** la validación añade solo costo de parseo en memoria; no se agrega ningún acceso a la base.
- **Idioma:** código de error en `snake_case` y en inglés como hoy; documentación y mensajes de commit en español.

## Notas de arquitectura

- Qué va a Zod: tipo, presencia, formato (UUID, email, `HH:MM`, teléfono E.164 básico, fecha ISO), rangos numéricos simples (`day_of_week` 0–6, `commission_rate` 0–1) y normalización de texto.
- Qué **no** va a Zod, y queda en `domain/` o en la base (principios 2 y 3): solapamiento de ventanas y de turnos, inicio < fin cuando depende de otro campo y ya es una regla de negocio nombrada, fecha en el pasado (`appointment_in_past`), jerarquía de comisiones, alcance por rol y estados.
- Traducción de error: cada esquema declara el código de error de cada regla; una función única traduce el primer fallo a `{ status, code }` y lanza el mismo `httpErr` que ya consume `errorHandler`. No se cambia `errorHandler`.
- Dónde invocar la validación: en el caso de uso (o en un paso explícito de la ruta) para endpoints donde el orden importa (RF-6); en la ruta para los que no tienen chequeo previo de recursos. El plan lo decide endpoint por endpoint.
- Frontend: fuera de alcance. Reutilizar esquemas en el frontend exigiría compartir código entre dos paquetes con módulos y toolchains distintos; se evalúa en una spec propia si hace falta.

## Casos límite

- `{}`, `null`, `[]`, `"texto"` o body ausente en un endpoint que espera objeto → 400 `invalid_body` (RF-10).
- `name: 123`, `email: {}`, `password: ["a"]` en `/auth/register` → 400 (RF-9), no 500.
- `name: "   "` (solo espacios) → se trata como vacío tras el recorte y responde `missing_fields`, igual que hoy con `""`.
- `email` con mayúsculas: se normaliza a minúsculas y `email_taken` sigue detectando el duplicado (RF-12).
- `PUT /staff/<id ajeno>/availability` con body inválido → 404, no 400 (RF-6).
- `PUT /staff/:id/availability` con `[{ "day_of_week": 1 }]` → 400 `missing_fields`; con `[{ "day_of_week": "1", ... }]` → 422 `invalid_day_of_week` (RF-5).
- Campo desconocido en el body (`{ "name": "A", "foo": 1 }`) → se ignora, no falla (RF-11).
- `scheduled_at: "no-es-fecha"` → mismo código que hoy (`invalid_date` o `invalid_scheduled_at` según el endpoint), no uno nuevo (RF-4).
- `GET /payments?from=2026-13-45` → 400 `invalid_period`, sin cambios (RF-4).
- Varios campos inválidos a la vez → un solo código, el del primer campo según el esquema (RF-3).
- `notes` ausente → `undefined`; `notes: null` → el comportamiento actual de cada endpoint se conserva (RF-13).

## Fuera de alcance

- Validar respuestas (outputs) de la API.
- Generar documentación OpenAPI desde los esquemas.
- Compartir esquemas con el frontend, o validar formularios del frontend con Zod.
- Cambiar códigos de estado o de error existentes, o unificar 400/422 en un solo criterio.
- Mover reglas de negocio de `domain/` a Zod.
- Mensajes de error localizados o con detalle por campo en la respuesta.
- Migrar el backend a TypeScript para aprovechar la inferencia de tipos.

## Criterios de finalización

- Cada RF con test automatizado. Se priorizan los casos no obvios:
  1. Caracterización: un test por cada código de error de forma/formato existente demuestra que estado y código no cambian (RF-4, RF-5).
  2. Orden de evaluación: `PUT /staff/:id/availability` con body inválido sobre un trabajador ajeno → 404, y sobre uno inactivo con body inválido → 422 antes que 400 (RF-6).
  3. Huecos: tipos incorrectos en `register`, `services`, `clients` y `bookings` responden 4xx y no 500 (RF-9, RF-10).
  4. Campos desconocidos ignorados y opcionales conservados (RF-11, RF-13).
  5. Determinismo con varios fallos (RF-3).
- Búsqueda de `missing_fields` y de `typeof`/`Number.isNaN` de validación de entrada en `routes/` y `domain/`: queda solo lo que no es de forma (RF-15).
- `npm test` y `npm run db:migrate` en verde sobre una DB vacía.
- Demo manual: `curl` a `POST /auth/register` con `{"name":123}` → 400; con el body completo → 201; `PUT /staff/<otro>/availability` con basura → 404.

## Dudas abiertas

- Ninguna. Q1 y Q2 resueltas; ver D6 y D7.

## Registro de decisiones

- **D1** — Zod valida forma y formato; las reglas de negocio quedan en `domain/` y en la base. Mantiene el principio 2 (invariantes en la DB) y el 3 (capas puras) y evita que el esquema se convierta en un segundo dominio.
- **D2** — La migración conserva estados y códigos de error (RF-4): es un refactor, no un rediseño del contrato. Los únicos cambios visibles son 500 → 4xx (RF-9).
- **D3** — Sin modo estricto (RF-11): ignorar campos desconocidos es compatible con el comportamiento actual y evita romper clientes.
- **D4** — La validación respeta el orden por endpoint (RF-6) en lugar de un middleware global, para no filtrar existencia de recursos ajenos (spec 004 RF-10, constitución principio 6).
- **D5** — Solo backend (YAGNI, principio 11): compartir esquemas con el frontend queda para una spec posterior si aparece la necesidad.
- **D6** — (Q1) Se migran todos los endpoints en esta spec (RF-14): una validación a medias deja dos estilos conviviendo, que es justo lo que la spec busca eliminar; cada endpoint es un cambio pequeño y verificable por separado.
- **D7** — (Q2) Los tipos incorrectos de RF-9 reutilizan el código existente del campo cuando lo hay; si no, responden `invalid_body`. No se agregan códigos por campo (`invalid_name`, `invalid_email`): el contrato público no crece.
