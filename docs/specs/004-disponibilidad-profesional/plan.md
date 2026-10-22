# Plan 004 — Disponibilidad semanal del profesional

Deriva de `spec.md` (18 RF). Sin código: módulos, modelo de datos, decisiones
y estrategia de tests. Cada parte indica los RF que cubre.

## 1. Módulos

### `domain/` (puro, sin I/O)

- **`domain/availabilityWindows.js`** (nuevo) — validación de un horario semanal:
  - `timeToMinutes('HH:MM')` → entero 0..1439; lanza 422 si el formato no es `HH:MM` válido (también rechaza `24:00` y `HH:MM:SS`). → RF-7
  - `formatTime('09:00:00' | '09:00')` → `'09:00'` (normalización de salida). → RF-2
  - `normalizeWindows(body)` → lista `[{ day_of_week, start_time, end_time }]` ya validada y ordenada por día e inicio. Orden de chequeo: forma (cuerpo no-lista, ventana no-objeto o con campo faltante → 400, RF-5) → valores (`day_of_week` entero 0..6 → 422, RF-6; horas → 422, RF-7; `start < end` → 422, RF-8) → solapamiento por día con intervalos `[inicio, fin)` (adyacentes válidos; idénticas = solapadas → 422, RF-9). Lista vacía → `[]`. → RF-4..RF-9
- `domain/userStatus.js` — se reusa (`inactivo` no configurable). Sin cambios.

### `application/` (orquesta; recibe `db` y `repos`)

- **`application/getStaffAvailability.js`** (nuevo) — RF-1, RF-2, RF-13..RF-15
  1. `repos.users.findVisible` acotado a la cuenta → `undefined` → 404.
  2. `user.role !== 'staff'` → 404 (el owner no tiene horario, D5). `actor.role === 'staff' && actor.id !== user.id` → 404.
  3. `repos.availability.findByUser` → ventanas formateadas con `formatTime`, orden día/inicio.
- **`application/replaceStaffAvailability.js`** (nuevo) — RF-3..RF-12
  Orden fijo (RF-10): alcance (404, igual que arriba) → `user.status === 'inactivo'` → 422 (RF-11) → `normalizeWindows(body)` (400/422). Luego `db.transaction`: bloquear la fila del trabajador (`repos.users.lockById`, serializa reemplazos concurrentes) → `repos.availability.replaceForUser` → devolver el horario resultante. No toca `appointments` (RF-12).
  - Un `23P01` (exclusion_violation) o `23514` (check) que escape de la DB se traduce a 422: red final, no camino normal.
- `application/findAvailableProfessional.js` — **sin cambios de código**; el filtro RF-17 vive en el repo que consume (ver abajo). Se cubre con test.

### `infrastructure/http`

- **`routes/staff.js`** (modificar) — dos rutas nuevas bajo `/staff`, mismo patrón `auth` + `wrap` + `actorOf`:
  - `GET /:id/availability` → `getStaffAvailability`; 200. — RF-1, RF-2, RF-13..RF-15
  - `PUT /:id/availability` → `replaceStaffAvailability`; 200 con el horario resultante. `PUT` y no `PATCH`: el cuerpo es el estado final completo e idempotente (D1 de la spec; principio 7).
- **`routes/availability.js`** — sin cambios. Obtiene RF-17/RF-18 gratis al llamar a `userRepo.findWithAvailability` (sin caché).
- **`app.js`** — sin cambios.

### `infrastructure/db`

- **`repositories/availability.js`** (nuevo, exportado como `availability` en `repositories/index.js`):
  - `findByUser(db, userId)` → ventanas ordenadas por `day_of_week, start_time`.
  - `replaceForUser(tx, userId, windows)` → `DELETE ... WHERE user_id` + `INSERT` masivo (no inserta si la lista es vacía). El caller aporta la transacción.
- **`repositories/users.js`** (modificar):
  - `findWithAvailability` → añadir `role = 'staff'` y `status = 'activo'` a las condiciones. Lo consumen el cálculo de slots y `findAvailableProfessional`. → RF-17
  - `lockById(tx, id)` → `SELECT ... FOR UPDATE`; sólo se invoca dentro de una transacción. → RNF concurrencia

### `docs`

- **`docs/diseno-gestor-turnos.md` §4** — reemplazar el recurso `availability` por las rutas nuevas y quitar "pendiente" correspondiente.

## 2. Modelo de datos

Sin columnas nuevas. **Migración `0006_spec_004_availability_constraints.sql`** (escrita a mano, principio 8):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "availability"
  ADD CONSTRAINT "availability_day_of_week_range" CHECK (day_of_week BETWEEN 0 AND 6),
  ADD CONSTRAINT "availability_start_before_end"  CHECK (start_time < end_time);

CREATE TYPE "timerange" AS RANGE (subtype = time);

ALTER TABLE "availability"
  ADD CONSTRAINT "availability_no_overlap"
  EXCLUDE USING gist (
    user_id WITH =,
    day_of_week WITH =,
    timerange(start_time, end_time) WITH &&
  );
```

- Los dos `CHECK` respaldan RF-6/RF-8 en la DB (principio 2); se declaran también con `.check()` en `db/schema.js` (patrón de `services_duration_positive`) y entrada en `meta/_journal.json`.
- El `EXCLUDE` respalda RF-9. Un rango de tipo `timerange` es semiabierto `[inicio, fin)`: ventanas adyacentes **no** chocan, igual que el glosario. No se puede expresar en `schema.js`; queda sólo en la migración, como el trigger de solapamiento de turnos (0001).
- **Riesgo conocido (hallazgo de spec 002):** declarar una constraint en `schema.js` *y* en la migración puede duplicarla si `drizzle-kit` regenera. Tras migrar, se verifica con `\d availability` que cada constraint aparece una sola vez (T01).
- Datos previos: la tabla no tiene escritores hoy, por lo que no hay filas que violen las constraints nuevas.

## 3. Decisiones (con alternativa descartada)

- **D-P1. El no-solapamiento vive en la DB (`EXCLUDE`) y se valida también en dominio.** Principio 2: una regla que debe cumplirse siempre es invariante de DB. El dominio da el 422 legible antes de tocar la DB. *Descartado:* sólo validar en la app — una inserción por otra vía (seed, consola) dejaría ventanas solapadas y `findAvailableProfessional` devolvería slots duplicados.
- **D-P2. `btree_gist` + tipo `timerange` propio.** Es la forma estándar de excluir rangos por igualdad de columnas. Justificación de la "nueva dependencia" (principio 1): `btree_gist` es una extensión *contrib* incluida en la imagen oficial `postgres:17-alpine` que ya usa `docker-compose.yml`; no suma paquetes npm. *Descartado:* constraint por expresión `int4range(EXTRACT(EPOCH...))` — depende de que la expresión sea inmutable y es menos legible. *Plan B si la extensión no estuviera disponible en producción:* validación de dominio + `lockById` (D-P3) como única garantía, registrándolo como deuda.
- **D-P3. `FOR UPDATE` sobre la fila de `users`, además del `EXCLUDE`.** Dos `PUT` simultáneos hacen `DELETE`+`INSERT`; sin lock el segundo chocaría con el `EXCLUDE` y devolvería un error evitable. Con el lock, se serializan y gana el último en confirmar (RNF). *Descartado:* `SERIALIZABLE` para toda la transacción — sube el costo y obliga a reintentos en el cliente.
- **D-P4. Reemplazo total con `DELETE`+`INSERT`, no diff por ventana.** El conjunto es pequeño (≤ decenas de filas) y reemplazar mantiene la validación sobre el estado final (D1 de la spec). Las filas de `availability` no son referenciadas por otras tablas, así que borrar no rompe historial (la baja lógica de la constitución, principio 5, aplica sólo a `services` y `appointments`). *Descartado:* upsert por ventana — exige identificar ventanas y complica la atomicidad.
- **D-P5. Alcance por rol dentro del caso de uso, no en middleware.** Mismo criterio que D-P3 de la spec 001: distinguir 404 de 422/400 exige cargar al trabajador primero (RF-10). *Descartado:* middleware `staffScope` — no tiene el recurso a mano.
- **D-P6. Filtro RF-17 en `findWithAvailability`, no en cada consumidor.** Un solo punto cubre slots y autoasignación. *Descartado:* filtrar en `routes/availability.js` y en `findAvailableProfessional` por separado — dos lugares que pueden divergir.
- **D-P7. Rutas bajo `/staff/:id/availability`, no `/availability/users/:id`.** `/availability/:business_id` ya captura un segmento; anidar bajo `/staff` evita ambigüedad de rutas y agrupa lo que sólo owner/staff autenticados usan. *Descartado:* `/me/availability` — innecesario porque el owner no tiene horario (D5 de la spec) y el staff puede usar su propio id.

## 4. Estrategia de tests (TDD, principio 9)

Orden: primero los casos **no obvios**; después el happy-path.

### Unit — `tests/domain/availabilityWindows.test.js` (nuevo, sin DB)
- Solapamiento: `09-13` + `12-15` → 422; idénticas → 422; adyacentes `09-13` + `13-17` → válidas; mismas horas en días distintos → válidas. — RF-9, caso límite
- `start >= end` → 422; `24:00` y `9:00` y `09:00:00` → 422; `23:59` válido. — RF-7, RF-8
- `day_of_week` `"1"`, `1.5`, `7`, `-1` → 422; ausente → 400; cuerpo no-lista / ventana no-objeto → 400. — RF-5, RF-6
- `[]` → `[]`; resultado ordenado por día e inicio. — RF-4
- `formatTime('09:00:00')` → `'09:00'`. — RF-2

### Application — `tests/application/` (repos fake, `db={}` con `transaction` stub)
- `getStaffAvailability.test.js`: otra cuenta → 404; id de owner → 404; staff pidiendo a un compañero → 404; owner y staff-self → 200 con formato `HH:MM`; sin ventanas → `[]`. — RF-1, RF-2, RF-13..RF-15
- `replaceStaffAvailability.test.js`:
  - Orden de evaluación: trabajador ajeno + cuerpo inválido → **404**, no 400/422 (RF-10); `inactivo` + cuerpo inválido → 422 por estado; `pendiente` → ok (RF-11).
  - Cuerpo inválido no llama a `replaceForUser` ni abre transacción. — RF-5..RF-9
  - OK: `lockById` antes de `replaceForUser`, dentro de `db.transaction`; no se llama a ningún repo de `appointments` (RF-12). — RF-3, RF-12
  - Error de DB `23P01` simulado → 422. — red final de D-P1

### Integración — `tests/integration/staffAvailability.test.js` (Postgres real, `withAccount`)
1. Atomicidad: con horario previo A, un reemplazo cuya inserción falla a mitad (ventana con `start > end` pasada directo al repo, saltando el dominio → viola `availability_start_before_end`) → el horario A sigue intacto. — RF-3, RNF
2. `EXCLUDE`: insertar dos ventanas solapadas directo por el repo → error de DB; adyacentes → ok. — RF-9, D-P1
3. Reemplazo → `GET`: ventanas devueltas en orden; lista vacía deja `[]`. — RF-1, RF-4
4. Slots/autoasignación: con 4 usuarios (staff activo, staff `pendiente`, staff `inactivo`, owner), todos con ventana, `findWithAvailability` sólo devuelve el staff activo; `findAvailableProfessional` no asigna a los demás. — RF-17
5. Reflejo inmediato: tras reemplazar, `findWithAvailability` ya devuelve el horario nuevo (sin caché). — RF-18
6. Alcance por rol end-to-end: staff sobre compañero → 404; owner sobre su propio id → 404; otra cuenta → 404 y nunca 403. — RF-15, RF-16
7. Turno agendado fuera de la nueva ventana sigue `agendado` tras el reemplazo. — RF-12
8. Migración: `npm run db:migrate` sobre DB vacía aplica `0006`; `\d availability` muestra cada constraint una sola vez. — modelo de datos
9. Concurrencia: dos `replaceForUser` simultáneos sobre el mismo trabajador (con `lockById`) → ambos terminan sin error y el resultado es exactamente uno de los dos horarios. — RNF

### Gate
`npm test` (unit + application + integración) y `npm run db:migrate` en verde sobre DB vacía antes de cada commit.

## 5. Mapa RF → módulo

| RF | Dónde se cubre |
|---|---|
| RF-1 | `getStaffAvailability` + `availabilityRepo.findByUser` |
| RF-2 | `formatTime` en `getStaffAvailability` / `replaceStaffAvailability` |
| RF-3 | `replaceStaffAvailability` + `availabilityRepo.replaceForUser` (transacción) |
| RF-4 | `normalizeWindows` (lista vacía) + `replaceForUser` |
| RF-5 | `normalizeWindows` (forma → 400) |
| RF-6, RF-7, RF-8 | `normalizeWindows` + CHECK `0006` |
| RF-9 | `normalizeWindows` + `EXCLUDE` `0006` |
| RF-10 | orden de pasos en `replaceStaffAvailability` |
| RF-11 | `replaceStaffAvailability` (estado `inactivo` → 422) |
| RF-12 | `replaceStaffAvailability` (no toca `appointments`) |
| RF-13, RF-14, RF-15 | scoping en `getStaffAvailability` / `replaceStaffAvailability` |
| RF-16 | ningún camino emite 403 (verificado en integración 6) |
| RF-17 | `userRepo.findWithAvailability` (role/status) |
| RF-18 | sin caché; `routes/availability.js` sin cambios |
| RNF concurrencia/atomicidad | `db.transaction` + `userRepo.lockById` |

## 6. Verificación

- `npm run db:migrate` limpio sobre DB vacía (aplica `0000`..`0006`).
- `npm test` verde: unit + application + integración.
- Recorrido manual (`curl`) del flujo de "Criterios de finalización" de `spec.md`: owner invita y staff activa → `PUT /staff/:id/availability` → `GET /availability/:business_id` ofrece slots → `PUT []` → ya no ofrece → `PUT` solapado → 422 → otro staff → 404 → id del owner → 404.

## 7. Archivos tocados (resumen)

- **Nuevos:** `domain/availabilityWindows.js`, `application/{getStaffAvailability,replaceStaffAvailability}.js`, `infrastructure/db/repositories/availability.js`, `db/migrations/0006_spec_004_availability_constraints.sql`, tests unit/app/integración nuevos.
- **Modificados:** `infrastructure/http/routes/staff.js`, `infrastructure/db/repositories/{users,index}.js`, `db/schema.js`, `db/migrations/meta/_journal.json`, `docs/diseno-gestor-turnos.md`.
