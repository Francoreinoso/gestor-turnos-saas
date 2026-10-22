# Plan 006 — Presentación del proyecto: README, datos demo, Docker y CI

Deriva de `spec.md` (35 RF). Sin código: módulos, decisiones y estrategia de
tests. Cada parte indica los RF que cubre. Sin migraciones de esquema: el
modelo de datos no cambia. **Depende de la spec 005 ya implementada y
mergeada** (rutas públicas, pantallas públicas, Vitest, `middleware/errorHandler.js`).

## 1. Backend

### Seed — `db/seed.js` (nuevo)

Junto a `migrate.js`, con la misma forma: módulo que exporta una función y un
arranque de línea de comandos protegido para que el import no ejecute nada.

- **`seedDemo(db, { now, accountId, emailPrefix, ifMissing, env, log })`** — RF-19..RF-28
  - Valores por defecto: `now = new Date()`, `accountId = DEMO_ACCOUNT_ID` (`00000000-0000-4000-8000-000000000001`), `emailPrefix = 'demo'`, `env = process.env`. Los parámetros existen para que los tests no toquen la cuenta demo real de la base de desarrollo.
  - **Guarda de producción**: `env.NODE_ENV === 'production'` → lanza antes de abrir transacción (RF-24).
  - **Una sola `db.transaction`** (RF-23): (1) busca la cuenta por `accountId`; si existe y `ifMissing` → devuelve `{ skipped: true }` (RF-22); si existe → la borra (el `ON DELETE CASCADE` ya limpia usuarios, turnos, pagos, clientes, servicios y horarios); (2) crea cuenta con id fijo, owner, 2 profesionales `activo` con contraseña hasheada (`bcrypt`, misma configuración que `routes/auth.js`) y comisiones distintas; (3) crea 3 servicios con historial (uno con cambio de precio, para que el historial tenga dos filas); (4) horarios vía `replaceStaffAvailability` con el owner como actor (RF-20); (5) 4 clientes; (6) turnos vía `createAppointmentFromPanel`; (7) el bloqueo vía `appointmentRepo.create`; (8) el cancelado: se crea `agendado` y se pasa a `cancelado` por repositorio.
  - **Fechas** (RF-28): los `completado` van a `now − 1..13 días` a una hora fija dentro de la jornada, alternando profesional y servicio, sin repetir profesional+hora; los `agendado` van a los **próximos días hábiles** (lunes a viernes) a horas que caen dentro de la ventana del profesional elegido y cuyo servicio cabe entera en esa ventana; se calculan con `nextBusinessDay(now, k)`, función pura exportada.
  - Devuelve `{ accountId, owner, staff[], bookingPath, managePath }` con las credenciales en claro (son datos demo, RF-26).
- **Línea de comandos** (`node db/seed.js [--if-missing]`): abre su propio `pg.Pool`, comprueba que la base está migrada (existe la tabla `accounts` y `__drizzle_migrations`; si no, mensaje `ejecuta npm run db:migrate primero`, RF-25), invoca `seedDemo`, imprime el resumen con `FRONTEND_URL` (por defecto `http://localhost:5173`) y termina con código distinto de cero ante cualquier error.
- **`package.json`**: script `"db:seed": "node db/seed.js"`.

### Salud — `routes/health.js` (nuevo) — RF-15

- `createHealthRouter({ ping })` → `GET /` con `ping()` (por defecto `db.execute(sql\`select 1\`)`): 200 `{ status: 'ok' }`; si lanza o excede 2 s → 503 `{ status: 'unavailable' }`, sin mensaje de error ni detalles. Fábrica con `ping` inyectable para probar el 503 sin tumbar Postgres.
- `app.js`: `app.use('/health', createHealthRouter({ ping }))` **antes** de cualquier limitador y sin auth.

### Docker del backend — RF-16

- `backend/Dockerfile`: `npm ci --omit=dev`, `USER node`, `HEALTHCHECK` con `wget` contra `/health` (BusyBox lo trae en `node:22-alpine`). La imagen **no** define `NODE_ENV`: el cliente de DB activa SSL con `production` (`infrastructure/db/client.js`) y la base de Compose no lo ofrece, así que el valor efectivo (`development`) lo fija Compose (D-P2).
- `backend/.dockerignore` (nuevo): `node_modules`, `.env*` (salvo `.env.example`), `tests`, `*.log`, `.git`.

## 2. Docker y entorno (raíz y frontend)

### `docker-compose.yml` (reescrito) — RF-12..RF-14, RF-17, RF-18

Servicios (todos con `restart` por defecto y `TZ` desde el `.env`):

| Servicio | Imagen | Función | Depende de |
|---|---|---|---|
| `db` | `postgres:17-alpine` | base; `healthcheck: pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`; puerto publicado `${DB_PORT:-5432}` | — |
| `setup` | build `./backend` | **un solo uso**: `node db/migrate.js && node db/seed.js --if-missing` si `SEED_DEMO=true`, si no solo migra; `restart: "no"` | `db` sano |
| `backend` | build `./backend` | API; `healthcheck` de `/health`; `${BACKEND_PORT:-3000}:3000` | `setup` completado con éxito |
| `frontend` | build `./frontend` | `nginx`; `healthcheck`; `${FRONTEND_PORT:-5173}:80` | `backend` sano |

- `DATABASE_URL` se arma en Compose: `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`; ya no es variable del `.env` (RF-12).
- `NODE_ENV: development` explícito en `setup` y `backend`.
- Si `setup` falla, `backend` no arranca y el error queda en `docker compose logs setup` (RF-13).

### `frontend/Dockerfile` y `frontend/nginx.conf` (nuevos) — RF-17

- Multi-etapa: `node:22-alpine` (`npm ci`, `npm run build`) → `nginx:alpine` con los archivos de `dist/`.
- `nginx.conf`: `location /api/ { proxy_pass http://backend:3000/; }` (la barra final quita el prefijo, igual que el `rewrite` de `vite.config.ts`); `location / { try_files $uri /index.html; }` para las rutas del navegador; cabeceras de proxy estándar. Cache largo solo para `/assets/`.
- `frontend/.dockerignore`: `node_modules`, `dist`, `.env*`.

### `.env.example` (raíz, reescrito) — RF-11, RF-18

Variables con valores de desarrollo funcionales: `POSTGRES_DB=saas_dev`, `POSTGRES_USER=saas`, `POSTGRES_PASSWORD=saas`, `JWT_SECRET=<cadena evidente de desarrollo>` con comentario de cambiarla, `SEED_DEMO=true`, `TZ=America/Santiago`, `DB_PORT`, `BACKEND_PORT`, `FRONTEND_PORT`. Cada una comentada en una línea. Se alinea `backend/.env.example` (sigue siendo para desarrollo sin Docker, con `localhost`).

## 3. CI — `.github/workflows/ci.yml` (nuevo) — RF-29..RF-33

- Disparadores: `push` a `main` y `pull_request`. `permissions: contents: read`. `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`.
- **`backend`** — matriz `tz: [UTC, America/Santiago]`; `services.postgres` con `postgres:17-alpine` y `--health-cmd pg_isready`; `actions/checkout@v4`, `actions/setup-node@v4` (`node-version: 22`, `cache: npm`, `cache-dependency-path: backend/package-lock.json`); pasos `npm ci` → `npm run db:migrate` → `npm test`, con `DATABASE_URL`, `JWT_SECRET` y `TZ` en `env`. `working-directory: backend`.
- **`frontend`** — mismos pasos de Node; `npm ci` → `npm run lint` → `npm test` → `npm run build`.
- **`smoke`** — `needs: [backend, frontend]`; `cp .env.example .env`; `docker compose config -q`; `docker compose up --build --wait --wait-timeout 300`; comprobaciones con `curl --fail`: `http://localhost:3000/health`, `http://localhost:5173/api/public/accounts/00000000-0000-4000-8000-000000000001` (verifica proxy y seed, y que traiga servicios) y `http://localhost:5173/reservar/00000000-0000-4000-8000-000000000001` (fallback de rutas); `if: failure()` → `docker compose logs`; `always()` → `docker compose down -v`.
- Versiones de acciones fijadas a la mayor (`@v4`) y cachés de npm (RF-33).

## 4. Documentación

- **`README.md`** (nuevo, español) — RF-1..RF-9, RF-27, RF-35. Secciones en el orden de RF-1. Puntos que no son obvios:
  - Insignia: `https://github.com/Francoreinoso/gestor-turnos-saas/actions/workflows/ci.yml/badge.svg` enlazada al workflow.
  - Inicio rápido (3 comandos): `git clone …`, `cp .env.example .env`, `docker compose up --build`; luego tabla de URLs (`:5173` app, `:3000/health`, `:5173/reservar/00000000-0000-4000-8000-000000000001`) y credenciales demo con la advertencia de RF-5.
  - Arquitectura: diagrama `mermaid` de capas (`domain` ← `application` ← `infrastructure`) y de los cuatro servicios de Compose.
  - Tabla de roles derivada de `docs/diseno-gestor-turnos.md` §3.10 y de las specs 001–005.
  - Límites conocidos y pendientes (RF-6), incluyendo capturas y licencia.
  - Estructura del repositorio (árbol real, con `docs/specs` y `.github`).
- **`docs/constitution.md`** — enmienda del principio 1 (RF-34), **en un commit propio** (la constitución lo exige): "Node + Express 5 (JavaScript con módulos ES) en el backend; React + Vite + React Router en TypeScript en el frontend, con Vitest y Testing Library como herramientas de prueba; Drizzle ORM, PostgreSQL, JWT". Se mantiene la frase sobre dependencias y se agrega una línea de enmienda con fecha al pie.
- **`docs/diseno-gestor-turnos.md`** — §5 (árbol de carpetas: `schema.js`, `drizzle.config.js`, `components/`, `docs/specs/`, `.github/`), §6 (pendientes: pagos y disponibilidad ya implementados; notificaciones y adjuntos pendientes) y una nota con `GET /health`. → RF-35

## 5. Decisiones (con alternativa descartada)

- **D-P1. Un servicio `setup` de un solo uso en vez de migrar dentro del arranque del backend.** El backend no debe correr migraciones al iniciarse en cada réplica, y un fallo de migración tiene que ser un fallo visible de un servicio, no un reinicio en bucle. *Descartado:* `entrypoint` que migra y luego arranca — mezcla dos responsabilidades y oculta el error dentro de los logs del proceso principal.
- **D-P2. La imagen del backend no fija `NODE_ENV`; lo fija Compose.** `infrastructure/db/client.js` activa SSL en `production`, y la base del Compose no lo ofrece; fijar `production` en la imagen rompería el arranque local. *Descartado:* tocar el cliente de DB para leer una variable `DB_SSL` — cambio de comportamiento fuera del alcance de esta spec; queda anotado como mejora en el roadmap del README.
- **D-P3. Seed por función exportada con parámetros de identidad (`accountId`, `emailPrefix`).** Los tests de integración comparten la base con el desarrollo; sin estos parámetros, probar el seed borraría la demo real. *Descartado:* probarlo solo por línea de comandos en un proceso aparte — más lento, sin acceso a las fábricas de datos y con el mismo riesgo de pisar la demo.
- **D-P4. El seed borra con cascada y no con borrados explícitos tabla por tabla.** Ya se verificó que `payments` (`ON DELETE RESTRICT` hacia `appointments`) no impide el borrado de la cuenta; un test lo fija para que un cambio futuro del esquema lo detecte. *Descartado:* borrar pagos primero a mano — duplica el conocimiento de las FK y envejece mal.
- **D-P5. `/health` con `ping` inyectable.** Permite probar el 503 sin detener Postgres. *Descartado:* un 200 fijo (no distingue "proceso vivo" de "puede atender", justo lo que el orquestador y el humo necesitan) o dejarlo sin test.
- **D-P6. El humo de CI vive en un job aparte que espera a backend y frontend.** Construir imágenes cuesta minutos; no tiene sentido si los tests ya fallaron. *Descartado:* correr el humo en paralelo — gasta tiempo de ejecución en cada fallo trivial.
- **D-P7. `docker compose up --wait` en CI y `curl --fail` por HTTP real contra el proxy del frontend.** Prueba lo que verá el revisor (nginx, fallback de rutas, seed), no una réplica en memoria. *Descartado:* probar `nginx.conf` con un linter — valida la sintaxis pero no que `/api` llegue al backend.
- **D-P8. El test del README vive en el backend y lee archivos con `fs`.** Es el único workspace con runner antes de la spec 005 y no requiere dependencias. *Descartado:* script de shell en CI — no corre en local con `npm test` y se olvida.

## 6. Estrategia de tests (TDD, principio 9)

Orden: primero los casos **no obvios**; después el camino feliz.

### Unit (`node:test`, sin DB)
- `tests/docs/readme.test.js` — RF-10. **Primero se escribe y se ve fallar** (no existe README); después el README. Casos: cada `npm run X` citado existe en el `package.json` del directorio indicado (se detecta `backend`/`frontend` por contexto: `cd backend`, `cd frontend` o por línea explícita); cada variable de `.env.example` y de `backend/.env.example` aparece en el README; cada enlace relativo (`](ruta)`) existe en disco; el README menciona el UUID fijo de la demo. Un caso con README sintético verifica que el test **sí** detecta un script inexistente, una variable sin documentar y un enlace roto.
- `tests/domain/…` — `nextBusinessDay(now, k)`: salta sábado y domingo, nunca devuelve el día de `now`, k=1 un viernes → lunes; cruce de medianoche. — RF-28

### Integración (Postgres real, `withAccount` no aplica: el seed crea su propia cuenta)
`tests/integration/seed.test.js`, siempre con `accountId` y `emailPrefix` aleatorios y limpieza al final:
1. Conteos de RF-19: 1 owner, 2 profesionales `activo`, 3 servicios, historial de precio con 2+ entradas para el servicio cuyo precio cambió, 4 clientes, ≥6 `completado` **con pago**, ≥4 `agendado` **con token**, 1 bloqueo futuro, 1 `cancelado`. — RF-19, RF-20
2. Los pagos tienen comisión coherente con el profesional (la tasa aplicada es la del profesional) y `employee_amount + business_amount = amount`. — RF-20
3. Los `agendado` caen en días hábiles, dentro de una ventana del profesional asignado, completos, sin solaparse entre sí ni con el bloqueo. — RF-28
4. Dos ejecuciones seguidas → exactamente una cuenta con ese id, otras cuentas intactas (se crea una cuenta ajena antes y se verifica después). — RF-21
5. `ifMissing` con la cuenta existente → `{ skipped: true }` y **ningún** dato modificado (mismos ids de turnos antes y después). — RF-22
6. Fallo forzado a mitad (un repositorio inyectado que lanza en el paso 6) → la cuenta anterior sigue con sus datos originales. — RF-23
7. `env.NODE_ENV = 'production'` → rechaza y no escribe nada. — RF-24
8. El borrado en cascada de una cuenta con turnos **y pagos** funciona (fija D-P4). — RF-21
9. Slots: tras el seed, `GET /availability` (vía `listAvailableSlots`) ofrece horarios para "Cualquiera" en los próximos días hábiles. — RF-19 (los horarios solapados de los dos profesionales)
- `tests/integration/health.test.js`: con `ping` real → 200 y cuerpo `{ status: 'ok' }`; con `ping` que lanza → 503 y cuerpo sin mensaje de error; sin cabecera de autenticación en ambos. — RF-15

### Verificación de infraestructura (manual, una vez; luego la hace el CI)
- `docker compose config -q` sin errores; `docker compose up --build --wait` desde un clon limpio (sin `node_modules`, sin `.env` salvo la copia); comprobar las tres URL del humo; `docker compose down -v && docker compose up` vuelve a sembrar; un segundo `up` sin `down -v` no recrea la demo (RF-22).
- La imagen del backend no contiene `.env` ni `tests`: `docker run --rm <img> ls -a /app`. — RF-16

### Gate
Backend: `npm test` y `npm run db:migrate` verdes. Frontend: `npm test`, `npm run lint`, `npm run build` verdes. La CI en GitHub verde en los tres jobs.

## 7. Mapa RF → módulo

| RF | Dónde se cubre |
|---|---|
| RF-1, RF-3..RF-9 | `README.md` |
| RF-2, RF-27 | `README.md` (inicio rápido y credenciales) + UUID fijo del seed |
| RF-10 | `tests/docs/readme.test.js` |
| RF-11 | `.env.example` raíz |
| RF-12, RF-13, RF-14, RF-18 | `docker-compose.yml` (`setup`, healthchecks, `TZ`, `DATABASE_URL` derivada) |
| RF-15 | `routes/health.js` + `app.js` |
| RF-16 | `backend/Dockerfile`, `backend/.dockerignore` |
| RF-17 | `frontend/Dockerfile`, `frontend/nginx.conf`, servicio `frontend` |
| RF-19, RF-20 | `seedDemo` (casos de uso + repositorios) |
| RF-21, RF-22, RF-23 | `seedDemo` (cascada, `ifMissing`, transacción) |
| RF-24, RF-25, RF-26 | arranque de `db/seed.js` y guarda de producción |
| RF-28 | `nextBusinessDay` + elección de horas del seed |
| RF-29..RF-33 | `.github/workflows/ci.yml` |
| RF-34 | `docs/constitution.md` (commit propio) |
| RF-35 | `docs/diseno-gestor-turnos.md` §5/§6, `README.md` |

## 8. Verificación final

- Los comandos de la sección "Gate" en verde y la CI de GitHub en verde (se necesita un `push`, que decide el usuario).
- Demo manual de "Criterios de finalización" de `spec.md` desde un directorio vacío, con cronómetro: clonar, `cp .env.example .env`, `docker compose up --build`, abrir `:5173`, entrar como owner y como staff, abrir el enlace de reserva con el UUID fijo.

## 9. Archivos tocados (resumen)

- **Nuevos:** `README.md`, `backend/db/seed.js`, `backend/src/infrastructure/http/routes/health.js`, `backend/.dockerignore`, `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`, `.github/workflows/ci.yml`, `backend/tests/docs/readme.test.js`, `backend/tests/integration/{seed,health}.test.js`, `backend/tests/domain/nextBusinessDay.test.js` (o dentro del test del seed si la función queda en `seed.js`).
- **Modificados:** `docker-compose.yml`, `.env.example`, `backend/.env.example`, `backend/Dockerfile`, `backend/package.json`, `backend/src/infrastructure/http/app.js`, `docs/constitution.md`, `docs/diseno-gestor-turnos.md`.
