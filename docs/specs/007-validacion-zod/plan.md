# Plan 007 — Validación de entrada con Zod

Deriva de `spec.md` (15 RF). Sin código: módulos, decisiones y estrategia de
tests. Cada parte indica los RF que cubre. Sin migraciones: el modelo de datos
no cambia. Solo backend.

## 1. Mecanismo

### Dependencia

- `npm install zod` en `backend/` (versión 4.x vigente, con `^`). Es la única dependencia nueva; la justificación escrita está en la spec (principio 1). El frontend no se toca (D5).

### `domain/validation.js` (nuevo, puro) — RF-2, RF-3, RF-10

Dos piezas pequeñas, las únicas que conocen la forma de los errores de Zod:

- **`rule(code, status = 400)`** → devuelve el valor para el parámetro `error` de un esquema Zod (un string `"<status>:<code>"`). Cada esquema declara el código de cada regla *junto a la regla*. El estado va por esquema y no por código porque un mismo código tiene estados distintos según el endpoint: `invalid_commission_rate` es 400 en `PATCH /accounts/commission` y 422 en `PATCH /staff/:id`.
- **`parseInput(schema, data)`** → `schema.safeParse(data)`; si falla toma **solo el primer issue** (`issues[0]`, RF-3), decodifica `"<status>:<code>"` y lanza el mismo `httpErr(status, code)` que ya consume `errorHandler` (que no cambia). Si el issue no trae regla propia (p. ej. el cuerpo no es un objeto, o un tipo no previsto) → 400 `invalid_body`. Nunca se filtra `issue.message` de la librería ni el árbol de errores (RF-2).

Cómo distinguir "falta" de "tipo incorrecto" sin ampliar el contrato (D7): el parámetro `error` de cada campo es una función de issue. Si `iss.input === undefined` → el código de ausencia del campo (`missing_fields`); si hay valor del tipo equivocado → el código del campo si existe, o `invalid_body`. El helper `requiredText(code)` encapsula el caso común.

### `domain/schemas/` (nuevo, puro)

Un archivo por área, solo definiciones de esquema (sin I/O, principio 3):

- **`common.js`** — bloques reutilizables:
  - `requiredText()` → string, `trim`, no vacío; vacío/solo espacios/ausente → `missing_fields` (misma semántica que el `!name` actual). **No** recorta `password` (los espacios son válidos en una contraseña) ni `email` (solo minúsculas, RF-12).
  - `optionalText()` → string con `trim`; ausente → `undefined`; `null` → conserva el comportamiento actual del endpoint (RF-13).
  - `email()` → string en minúsculas; reutiliza el resultado de `normalizeEmail`.
  - `uuidField()` → UUID usando el mismo criterio que `domain/uuid.js` (versión y variante indistintas, como emite `gen_random_uuid()`), con `rule` según endpoint. Un solo criterio de UUID en el sistema.
  - `isoDate(code)` → string parseable como fecha, con el código propio del endpoint (`invalid_date` o `invalid_scheduled_at`). Entrega el **string** (no un `Date`): los casos de uso siguen haciendo `new Date(...)` y sus firmas no cambian (D-P3).
  - `phone()` → regex `PHONE_REGEX` importada de `domain/client.js` (una sola definición), `invalid_phone_format`.
  - `commissionRate(status)` → número 0–1 o `null`, `invalid_commission_rate` con el estado que corresponda.
  - `clientData()` → `{ name, email?, phone?, notes? }` (lista blanca; ver D-P5).
- **`auth.js`, `appointments.js`, `services.js`, `clients.js`, `accounts.js`, `staff.js`, `payments.js`, `availability.js`, `public.js`** — un esquema por entrada de endpoint (tabla de la sección 2).
- **`staff.js` reemplaza a `domain/staffEdit.js`** en lo que es forma (`assertOwnerEditablePayload`, `assertSelfEditablePayload`); `assertValidCommissionRate` desaparece al quedar cubierto por `commissionRate(422)`.

### Dónde se invoca (RF-6, RF-7, D4)

Regla única: **la llamada a `parseInput` ocupa el lugar exacto de las validaciones manuales que reemplaza**, nunca antes. Eso conserva el orden de evaluación de cada endpoint sin tener que razonarlo caso por caso:

- Casos de uso que ya reciben `body`/`query` crudo (`editStaff`, `editOwnProfile`, `editAppointment`, `replaceStaffAvailability`, `listAppointments`, `getPaymentsSummary`, `listPayments`, `inviteStaff`, `createAppointmentFromPanel`, `createAppointment`) → `parseInput` **dentro** del caso de uso, en el paso donde hoy están los chequeos de forma. Así en `replaceStaffAvailability` queda después de alcance (404) y estado (422), tal como pide la spec 004 RF-10.
- Rutas con lógica inline (`auth`, `services`, `clients`, `accounts`, `appointments/block`, `public/*`, `availability`) → `parseInput` en el handler. Si el handler busca primero el recurso (p. ej. `PATCH /services/:id`, `PATCH /clients/:id`, `PATCH /accounts/users/:id/commission`), la validación va **después** del 404; si no hay recurso previo (`POST`, login, registro, bookings), va primero. Los `ownerOnly`/403 siguen siendo middleware previo.
- Params (`:id`, `:business_id`): no pasan por Zod. La política de UUID inválido → 404 (RF-8) sigue en `isUuid`/los casos de uso.

## 2. Mapa por endpoint (RF-14)

"Códigos" son los que el endpoint devuelve hoy y se conservan (RF-4). "Nuevo" es lo que RF-9/RF-10 agregan.

| Endpoint | Esquema (campos, en el orden del chequeo actual) | Dónde se invoca | Códigos conservados · Nuevo |
|---|---|---|---|
| `POST /auth/register` | `business_name`, `name`, `email`, `password` | handler, primero | `missing_fields` · tipo incorrecto → `invalid_body` |
| `POST /auth/login` | `email`, `password` | handler, primero | `missing_fields` · idem |
| `POST /appointments` (panel) | `service_id`, `scheduled_at` (`isoDate('invalid_date')`), `client_id`, `client`, `employee_id`, `notes` | `createAppointmentFromPanel`, en lugar de los `if` de RF-4/RF-15 | `missing_fields`, `invalid_date` · UUID/tipos → `invalid_body` |
| `PATCH /appointments/:id` | `notes`, `service_id`, `client_id`, `assigned_user_id` — **estricto** | `editAppointment`, en lugar de `assertEditablePayload` | `invalid_field`, `empty_update` |
| `POST /appointments/block` | `assigned_user_id`, `scheduled_at`, `scheduled_until` (`invalid_date`), `notes` | handler, primero | `missing_fields`, `invalid_date` |
| `GET /appointments` | query: `status`/`type`, `date_from`, `date_to` (`invalid_date`), `employee_id` | `listAppointments` | `invalid_date` |
| `POST /services` | `name`, `duration_minutes` (entero > 0), `price` (decimal ≥ 0) | handler, primero | `missing_fields` · tipos → `invalid_body` |
| `PATCH /services/:id` | `name?`, `duration_minutes?` | handler, tras el 404 | — · tipos → `invalid_body` |
| `PATCH /services/:id/prices` | `price` | handler, tras `ownerOnly` y antes del 404 (hoy el `missing_fields` precede al 404; se conserva) | `missing_fields` |
| `GET /services` | query: `active` (`'true'`/`'false'`) | handler | hoy cualquier otro valor equivale a `false`; se conserva |
| `POST /clients` | `name`, `email?`, `phone?` (`invalid_phone_format`), `notes?`; regla cruzada email-o-teléfono | handler, primero | `missing_fields`, `email_or_phone_required`, `invalid_phone_format` |
| `PATCH /clients/:id` | `name?`, `email?`, `phone?`, `notes?` | handler, tras el 404 | `invalid_phone_format` |
| `PATCH /accounts/commission` | `commission_rate` (400) | handler, tras el 403 | `invalid_commission_rate` |
| `PATCH /accounts/users/:id/commission` | `commission_rate` (400) | handler, tras el 403 y antes del 404 (hoy valida primero; se conserva) | `invalid_commission_rate` |
| `PATCH /me` | `name?`, `password?` — **estricto** | `editOwnProfile`, en lugar de `assertSelfEditablePayload` | `invalid_field`, `empty_update` |
| `POST /staff` | `name`, `email`, `commission_rate?` (422) | `inviteStaff`, tras el 403 de staff | `missing_fields`, `invalid_commission_rate` (422) |
| `PATCH /staff/:id` | `name?`, `email?`, `commission_rate?` (nullable, 422) — **estricto** | `editStaff`, en lugar de `assertOwnerEditablePayload` | `invalid_field`, `empty_update`, `invalid_commission_rate` |
| `GET /staff` | query: `status` | `listStaff` | sin cambios |
| `PUT /staff/:id/availability` | lista de `{ day_of_week, start_time, end_time }`: **forma** (400) y **valores** (422) | `replaceStaffAvailability`, **después** de alcance y estado | `invalid_body`, `invalid_window`, `missing_fields`, `invalid_day_of_week`, `invalid_time_format`, `start_must_be_before_end` |
| `GET /availability/:business_id` | query: `date_from`, `date_to`, `service_id`, `employee_id?` | handler | código actual `date_from, date_to, service_id required` (con espacios; es parte del contrato, RF-4) · fecha ilegible → `invalid_date` (ver D-P6) |
| `GET /payments`, `GET /payments/summary` | query: `period`, `date_from`, `date_to`, `employee_id` (solo tipos string) | casos de uso | `invalid_period`, `ambiguous_period_filter` (siguen en `paymentsPeriod`, ver sección 3) |
| `POST /public/bookings` | `account_id`, `service_id`, `scheduled_at` (`invalid_scheduled_at` se mantiene en el dominio, ver D-P3), `client_id?`, `client?`, `employee_id?`, `notes?`; regla cruzada `client_required` | handler, primero | `missing_fields`, `client_required` |
| `PATCH /public/appointments/:id/reschedule` | `service_id?`, `scheduled_at`, `employee_id?`, `notes?` | handler, tras `publicAuth` | `missing_fields` |
| `POST /public/staff-invitations/activate` | `token`, `password` | handler, primero | `missing_fields` |
| `GET/PATCH` sin cuerpo (`/cancel`, `/cancel-block`, `/correct`, `/resend-invitation`, `/deactivate`, `GET /:id`) | ninguno | — | sin cambios |

## 3. Lo que NO migra a Zod (y por qué)

- **`paymentsPeriod.resolvePeriod`** (`invalid_period`, `ambiguous_period_filter`): el orden actual es *ambigüedad* → *fecha ilegible* → *preset desconocido*. Un esquema por campos evaluaría la fecha antes que la regla cruzada y cambiaría qué código ve el cliente con entradas doblemente inválidas (RF-4). Es además una regla de negocio nombrada con tests propios. El esquema de la query solo asegura que cada parámetro sea string.
- **`assertScheduledAtNotPast`** y el cálculo de `scheduled_at`: *fecha en el pasado* es regla de negocio (`appointment_in_past`). La conversión a `Date` y su código (`invalid_scheduled_at`) siguen en `appointmentScheduling`, que ya tiene tests unitarios y se invoca también desde la reprogramación.
- **Reglas con acceso a datos o estado**: `email_taken`, `client_not_found`, `service_not_found`, `invalid_status_transition`, `user_inactive`, solapamientos, alcance por rol. Siguen donde están (RF-7).
- **`resolveCommission`, `userStatus`, `staffInvite`, `token`**: no validan entrada.
- **`express.json()`**: un JSON con sintaxis rota lo rechaza `body-parser` antes de llegar a Zod (ver observaciones, sección 7).

## 4. Decisiones (con alternativa descartada)

- **D-P1. `parseInput` toma el primer issue y traduce a `httpErr`.** `errorHandler` y el formato `{ error }` no cambian (RF-2, RF-7). *Descartado:* middleware `validate(schema)` global por ruta — corre antes de los chequeos de alcance y de estado, y rompe el orden de la spec 004 RF-10 (D4 de la spec).
- **D-P2. El estado HTTP viaja con la regla (`rule(code, status)`), no con el código.** `invalid_commission_rate` es 400 en `accounts` y 422 en `staff`; una tabla código→estado sería ambigua. *Descartado:* dos pasadas por endpoint (esquema de forma → 400, esquema de valores → 422): duplica los esquemas. Se usa en la práctica solo en `staff.js` y `availability.js`, donde ya existe la distinción.
- **D-P3. Las fechas se validan en el esquema pero se entregan como string.** Los casos de uso siguen convirtiendo con `new Date`, sin cambiar firmas ni los tests existentes. En el booking público el `scheduled_at` conserva `invalid_scheduled_at` (lo lanza `assertScheduledAtNotPast`); el esquema solo exige `string`. *Descartado:* `z.coerce.date()` — cambia el tipo que recibe cada caso de uso y obliga a reescribir sus tests; además `coerce` acepta `null`/`0`/arrays como fechas válidas.
- **D-P4. Esquemas en `domain/schemas/`, no en `infrastructure/http`.** Son puros y reutilizables desde los casos de uso (principio 3), que es donde la validación tiene que correr para respetar el orden. Zod no es infraestructura: no hace I/O. *Descartado:* `infrastructure/http/schemas` — los casos de uso no pueden importar de infraestructura.
- **D-P5. `client` y los demás objetos anidados se declaran con lista blanca.** Hallazgo: `createAppointment` y `createAppointmentFromPanel` hacen `{ account_id: accountId, ...clientData }`; como `clientData` viene del body y se esparce **después** de `account_id`, un `client: { "account_id": "<otra cuenta>", ... }` pisaría la cuenta. Con el esquema (RF-11) las claves desconocidas no llegan al repositorio. Se cubre con un test de seguridad explícito (sección 6) y se corrige en el mismo cambio.
- **D-P6. `GET /availability/:business_id` con `date_from`/`date_to` ilegibles** devuelve hoy `200 []` (el bucle no itera con `Invalid Date`). Se pasa a 400 `invalid_date`: es el caso de "fecha que no es ISO" de RF-9 y coincide con el resto de endpoints. Es un cambio visible; se registra aquí y se cubre con test.
- **D-P7. Los endpoints de edición conservan el rechazo de campos desconocidos** (`invalid_field`/`empty_update`), con `z.strictObject` y una regla cruzada de "al menos un campo". Es la excepción de RF-11, justificada por RF-4. *Descartado:* ignorar silenciosamente campos desconocidos también ahí — cambiaría 400 → 200.
- **D-P8. Strings se recortan en el esquema solo donde la spec lo dice** (`name`, `business_name`, `notes`); `email` solo a minúsculas; `password` y `token` intactos.

## 5. Estrategia de implementación y de tests (TDD, principio 9)

Orden de trabajo: primero la red de seguridad, después el mecanismo, después endpoint por endpoint. Cada endpoint migrado es un commit pequeño.

1. **Caracterización (antes de tocar nada).** `tests/integration/validationContract.test.js`: una tabla `[método, ruta, body/query, estado, código]` con un caso por cada código de error de forma/formato de la sección 2, capturado contra el código **actual**. Debe pasar antes y después de cada migración. Es la prueba de RF-4, RF-5 y RF-6. Cubre también el orden de evaluación (trabajador ajeno + body inválido → 404; `inactivo` + body inválido → 422).
2. **Mecanismo** — `tests/domain/validation.test.js`: `rule` + `parseInput` con esquemas de juguete: primer issue determinista con varios fallos (RF-3), ausente vs. tipo incorrecto (D7), cuerpo `null`/array/string/`undefined` → `invalid_body` (RF-10), el mensaje de la librería nunca llega al error (RF-2), claves desconocidas descartadas vs. `strictObject` (RF-11), refinamientos cruzados que no corren si falla el tipo.
3. **Esquemas** — un `tests/domain/schemas/<área>.test.js` por archivo, sin DB: casos felices, cada código, normalización (`trim`, minúsculas, `password` intacto), opcionales conservados (RF-12, RF-13).
4. **Huecos (RF-9, RF-10)** — en `validationContract` o `tests/integration/inputHardening.test.js`: `name: 123`, `email: {}`, `password: ["a"]` en `/auth/register`; `price: "abc"`, `duration_minutes: 1.5` en `/services`; `notes: 5` en `/clients`; `scheduled_at: []` en `/public/bookings`; body `null`/`[]`/ausente en cada `POST`/`PATCH` → 4xx y nunca 500.
5. **Seguridad (D-P5)** — `POST /public/bookings` y `POST /appointments` con `client: { account_id: <otra cuenta> }`: el cliente se crea en la cuenta del token/`account_id` válido y nunca en la otra.
6. **Regresión** — se mantienen los tests existentes de `tests/domain/staffEdit.test.js`, `client.test.js`, `availabilityWindows.test.js` etc. reubicados o adaptados solo cuando una función de dominio desaparece (`assertValidCommissionRate`, `assertEditablePayload`...); la **conducta** que verifican pasa a probarse sobre el esquema. Ningún test de integración cambia su resultado esperado salvo los de D-P6.

### Gate
`npm test` (unit + application + integración) y `npm run db:migrate` en verde sobre DB vacía antes de cada commit.

## 6. Mapa RF → módulo

| RF | Dónde se cubre |
|---|---|
| RF-1 | `domain/schemas/*` (un esquema por entrada de endpoint) |
| RF-2 | `parseInput` (traducción a `httpErr`; nunca expone la librería) |
| RF-3 | `parseInput` (`issues[0]`; orden de campos del esquema) |
| RF-4 | test de caracterización + `rule(code, status)` en cada esquema |
| RF-5 | `schemas/staff.js` (disponibilidad: forma 400, valores 422) |
| RF-6 | regla de invocación (sección 1): `parseInput` en el lugar de la validación manual |
| RF-7 | sin cambios en autorización, estados, conflictos ni existencia (sección 3) |
| RF-8 | los params no pasan por Zod; `isUuid` → 404 se mantiene |
| RF-9 | esquemas con `invalid_body` / código del campo; tests de huecos |
| RF-10 | `parseInput` (tope: no-objeto → `invalid_body`) |
| RF-11 | esquemas no estrictos (descartan claves); `strictObject` en edición (D-P7) |
| RF-12 | `common.js` (`trim`, minúsculas) |
| RF-13 | `optionalText` y compañía conservan `undefined` |
| RF-14 | sección 2, cobertura completa |
| RF-15 | cada migración elimina los `if`/`typeof` de forma que el esquema cubre (sección 3 lista lo que se queda) |

## 7. Observaciones fuera de alcance

- **JSON malformado:** `express.json()` responde 400 con el mensaje de `body-parser` (texto de la librería, no un código). No es Zod y `errorHandler` no se toca en esta spec; candidato a un cambio mínimo posterior (mapear a `invalid_body`).
- **Validación de `email` con formato real** (hoy cualquier string no vacío): no se agrega para no rechazar lo que hoy se acepta (RF-4); se evalúa en otra spec.

## 8. Verificación

- `npm test` verde: caracterización + dominio + esquemas + integración.
- `npm run db:migrate` limpio sobre DB vacía (sin migraciones nuevas).
- Recorrido manual (`curl`) del flujo de "Criterios de finalización" de `spec.md`.
- Búsqueda en `routes/`, `application/` y `domain/` de `missing_fields`, `typeof` y `Number.isNaN`: solo quedan las excepciones de la sección 3.

## 9. Archivos tocados (resumen)

- **Nuevos:** `domain/validation.js`, `domain/schemas/{common,auth,appointments,services,clients,accounts,staff,payments,availability,public}.js`, `tests/domain/validation.test.js`, `tests/domain/schemas/*.test.js`, `tests/integration/{validationContract,inputHardening}.test.js`.
- **Modificados:** `backend/package.json` y `package-lock.json` (zod); las 10 rutas con entrada (todas menos `health`) bajo `infrastructure/http/routes/`; los casos de uso `createAppointment`, `createAppointmentFromPanel`, `editAppointment`, `editStaff`, `editOwnProfile`, `inviteStaff`, `replaceStaffAvailability`, `listAppointments`, `getPaymentsSummary`, `listPayments`; `docs/diseno-gestor-turnos.md` (sección de validación).
- **Reducidos o eliminados:** `domain/staffEdit.js`, `domain/appointmentEdit.js`, `domain/availabilityWindows.js` (la forma pasa al esquema; quedan `timeToMinutes`/solapamiento si siguen siendo reglas de negocio), `validatePhone` en `domain/client.js`.
