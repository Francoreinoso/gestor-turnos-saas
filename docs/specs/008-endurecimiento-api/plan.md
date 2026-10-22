# Plan 008 — Endurecimiento de la API

Deriva de `spec.md` (23 RF). Sin código: módulos, decisiones y estrategia de
tests. Cada parte indica los RF que cubre. Sin migraciones de esquema ni
endpoints nuevos. Dependencias nuevas: ninguna.

## 1. Backend

### `domain/` (puro, sin I/O)

- **`domain/schemas/common.js`** (modificar) — `newPassword()`: `string` requerido (ausente → `missing_fields`, como `requiredRaw`) con una regla `invalid_password` (400) si tiene menos de 8 **caracteres** o más de 72 **bytes** UTF-8 (`[...s].length` y `new TextEncoder().encode(s).length`; sin `Buffer`, para mantener la capa pura). Sin recortar. → RF-11
- **`domain/schemas/auth.js`** (modificar) — `registerBody.password = newPassword()`. `loginBody` **no** cambia (RF-11: el login no aplica la regla).
- **`domain/schemas/public.js`** (modificar) — el cuerpo de activación de trabajador usa `newPassword()`. → RF-11
- **`domain/schemas/staff.js`** (modificar) — en `editSelfBody`, `password` conserva `invalid_field` para tipos incorrectos y suma la regla `invalid_password` para longitud. → RF-11
- **`domain/schemas/payments.js`**, **`availability.js`** — sin cambios de forma; el filtro de pagos se resuelve en los casos de uso (ver abajo).

### `application/`

- **`application/login.js`** (nuevo) — `login(db, { email, password }, repos, { compare = bcrypt.compare, dummyHash = DUMMY_HASH })` → devuelve el usuario o lanza 401 `invalid_credentials`. **Siempre** ejecuta `compare`: contra `user.password_hash` si el usuario existe, está `activo` y tiene hash; contra `dummyHash` en cualquier otro caso (inexistente, `pendiente`, `inactivo`, sin contraseña). El resultado de una comparación ficticia se descarta. `DUMMY_HASH` = `bcrypt.hashSync('x', 10)` calculado una vez al cargar el módulo (costo 10, igual que `routes/auth.js`, D7). La firma del JWT sigue en la ruta. → RF-12
- **`application/inviteStaff.js`** (modificar) — recibe `body` (objeto crudo) en lugar de `name`/`email`/`commissionRate` sueltos, y lo valida con `parseInput(inviteStaffBody, body)` **después** del chequeo de rol (se conserva 403 antes que 400). `routes/staff.js` pasa `req.body` entero. Es el cambio que cierra RF-4: hoy la ruta desestructura un `req.body` que puede ser `undefined`. → RF-4
- **`application/createPayment.js`** (modificar) — las tres lecturas pasan de `Promise.all` a `await` secuenciales. → RF-20
- **`application/listPayments.js`**, **`getPaymentsSummary.js`** (modificar) — si `employee_id` (solo owner; el staff usa el suyo) no es un UUID válido, se consulta con `uuidOrNil` (`domain/uuid.js`): el UUID nulo `0000…0000`, que no existe, de modo que las consultas existentes devuelven vacío / ceros por sí solas y con la misma forma de respuesta. *(Cambio respecto del plan original, que reusaba la rama de rango vacío: así no se duplica el resultado vacío ni se cambia la forma de `byEmployee`.)* → RF-6, D9
- **`application/listAppointments.js`** (modificar) — un `employee_id` de owner que no es UUID → 400 `invalid_body`, validado **después** de resolver el rol (un staff ignora cualquier valor, spec 001 RF-42). *(El plan original suponía que ese filtro ya usaba `optionalUuid`; el esquema solo exigía `string` y daba 500.)* → RF-6

### `infrastructure/`

- **`infrastructure/config.js`** (nuevo) — `loadConfig(env)` → `{ port, trustProxy, nodeEnv, jwtSecret }` o lanza `ConfigError` con el nombre de la variable. Reglas de RF-14 (`JWT_SECRET` no vacío; `TRUST_PROXY` entero ≥ 0 con default 0; `PORT` entero 1..65535 si está definido; en `production`: secreto ≥ 32 y distinto de la lista `EXAMPLE_SECRETS` = valores de `.env.example` y `backend/.env.example`). El mensaje **nunca** incluye el valor del secreto (RF-15). Recibe el entorno como argumento: se prueba sin tocar `process.env`. → RF-10, RF-14, RF-15
- **`http/jwt.js`** (nuevo) — `signToken(payload)` (`{ algorithm: 'HS256', expiresIn: '7d' }`) y `verifyToken(token)` (`{ algorithms: ['HS256'] }`); leen `process.env.JWT_SECRET` en cada llamada (los tests lo fijan). Reemplazan los `jwt.sign`/`jwt.verify` sueltos de `routes/auth.js` (dos) y `middleware/auth.js`. → RF-13
- **`http/middleware/errorHandler.js`** (reescribir) — exporta `toResponse(err)` (puro) y `createErrorHandler({ log })`; el default export usa `console.error`.
  - `err.type === 'entity.parse.failed'` → 400 `invalid_body`; `'entity.too.large'` → 413 `payload_too_large`; `'encoding.unsupported'`/`'charset.unsupported'` → 415 `unsupported_media_type`.
  - `status` entre 400 y 499 y `message` que cumple `/^[a-z][a-z0-9_]*$/` → pasa tal cual (error de aplicación). Otro 4xx → su estado con `bad_request`.
  - Todo lo demás (sin `status`, `status >= 500`) → 500 `internal_error`, y se registra `method`, `req.path` (sin query) y `err.stack`; nunca cuerpos ni cabeceras. → RF-1, RF-2, RF-3, D1
- **`http/middleware/uuidParams.js`** (nuevo) — `uuidParams(router, { id: 'not_found', business_id: 'service_not_found' })`: registra `router.param(name, guard)` para cada nombre; la guarda responde 404 con el código indicado cuando `!isUuid(value)`, sin consultar la base. Se aplica a los routers `accounts`, `appointments`, `services`, `clients`, `staff` y `availability` (para este último el código es el que hoy devuelve un negocio inexistente, `service_not_found`). `public` queda fuera: `publicAuth` ya responde 401 y `getPublicAccount` 404. → RF-5
- **`http/middleware/securityHeaders.js`** (nuevo) — middleware de tres cabeceras (`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`). → RF-16
- **`http/middleware/limiters.js`** (nuevo) — `createLimiter({ windowMs, limit, skipSuccessfulRequests })` sobre `express-rate-limit` con `message: { error: 'too_many_requests' }` y `Retry-After`; instancias `loginLimiter` (10 / 15 min, `skipSuccessfulRequests: true`) y `registerLimiter` (5 / 60 min). Los dos limitadores de `routes/public.js` se construyen con la misma fábrica. → RF-8, RF-9, RF-10
- **`http/createApp.js`** (nuevo) — fábrica de la aplicación **sin** `listen` ni cron: `express()`, `app.disable('x-powered-by')`, `app.set('trust proxy', trustProxy)`, `securityHeaders`, `express.json()`, `/health`, la **tabla de rutas exportada** `ROUTES = [['/accounts', accountRoutes], …]` que es la que monta, y `errorHandler`. → RF-10, RF-16, y habilita RF-7
- **`http/app.js`** (modificar) — pasa a ser solo el arranque: `loadConfig(process.env)` (falla rápido, RF-14), `createApp(config)`, `startCron()` y `listen`. Un error de configuración imprime el mensaje y termina con código 1 sin abrir el puerto.
- **`http/routes/auth.js`** (modificar) — `loginLimiter` en `/login`, `registerLimiter` en `/register`, `login` del caso de uso y `signToken`. **`routes/staff.js`**: `router.use`/`uuidParams` y `inviteStaff` con `body`. Resto de routers: solo `uuidParams`.
- **`http/middleware/auth.js`** (modificar) — `verifyToken`.

### Orden de evaluación que se conserva
`uuidParams` corre al resolver el parámetro, **antes** de `auth` y del handler: un id mal formado da 404 aunque el token falte; es seguro porque no revela existencia de nada (la respuesta es la misma que para un id inexistente) y evita tocar la base.

## 2. Docker, nginx y CI

- **`docker-compose.yml`** — `backend.ports: "127.0.0.1:${BACKEND_PORT:-3000}:3000"` y `TRUST_PROXY: 1` con comentario (RF-18, RF-19, D4). `setup` no necesita `TRUST_PROXY`.
- **`frontend/security-headers.conf`** (nuevo, copiado a `/etc/nginx/`) — `add_header X-Content-Type-Options nosniff always; add_header X-Frame-Options DENY always; add_header Referrer-Policy no-referrer always;`.
- **`frontend/nginx.conf`** (modificar) — `include /etc/nginx/security-headers.conf;` en `location /assets/` (junto a su `Cache-Control`) y en `location /`. **No** se pone a nivel `server` ni en `location /api/`: en nginx un `add_header` en un `location` descarta los heredados, y en `/api/` duplicaría las cabeceras que ya manda el backend. → RF-17
- **`.github/workflows/ci.yml`** (modificar) — job `frontend`: paso `npm run typecheck` (script nuevo `tsc --noEmit` en `frontend/package.json`). Job `smoke`: pasos que comprueban con `curl -sI` las tres cabeceras en `/`, en un archivo de `/assets/` (el nombre se lee del `index.html`) y en un 404 de `/assets/no-existe.js`, y que `/api/health` trae `nosniff` **una sola vez**. → RF-22
- **`.env.example`** raíz y **`backend/.env.example`** — se documenta `TRUST_PROXY` (comentado, `0`) en el de `backend/`; el README lo menciona (lo exige el test del README, spec 006 RF-10).

## 3. Frontend

- **`pages/LoginPage.tsx`** — `ERROR_LABELS` suma `too_many_requests` ("Demasiados intentos. Esperá unos minutos e intentá de nuevo.") y `invalid_password` ("La contraseña debe tener entre 8 y 72 caracteres."); el `input` de contraseña del modo registro lleva `minLength={8}`. → RF-21
- **`package.json`** — script `"typecheck": "tsc --noEmit"`. → RF-22

## 4. Documentación

- **`README.md`** — nueva sección "Seguridad" (lo que protege el sistema: errores genéricos, validación de ids, límites de login y registro, contraseña, validación de configuración, cabeceras, backend solo en loopback) y actualización de "Límites conocidos" con lo que queda fuera (JWT de 7 días sin revocación, sin CSP ni HSTS, límites en memoria por proceso, sin recuperación de contraseña); documenta `TRUST_PROXY`. → RF-23
- **`docs/diseno-gestor-turnos.md`** — nota en §4 de los códigos nuevos (`payload_too_large`, `unsupported_media_type`, `bad_request`, `invalid_password`, `internal_error`).

## 5. Decisiones (con alternativa descartada)

- **D-P1. `createApp()` y una tabla `ROUTES` exportada.** `app.js` arranca el puerto y el cron al importarse, y `tests/helpers/apiServer.js` duplica a mano el montaje de rutas (una ruta nueva olvidada ahí pasaría desapercibida). Con la tabla, la aplicación y los tests montan lo mismo y la prueba del criterio 1 recorre las rutas reales. *Descartado:* introspección de `app.router.stack` para reconstruir las rutas — depende de detalles internos de Express 5 que cambian entre versiones.
- **D-P2. La guarda de UUID usa `router.param`.** Es el mecanismo de Express para "este parámetro siempre se valida igual", corre antes de los handlers y no se puede olvidar por ruta. *Descartado:* validar con Zod en cada handler — es lo que hoy deja pasar la clase de defecto, porque exige acordarse en cada ruta nueva.
- **D-P3. Mensaje-código como criterio de "error de aplicación".** El manejador no necesita saber qué errores son nuestros: los nuestros ya siguen la convención `snake_case`. *Descartado:* una clase `HttpError` — obliga a reescribir los ~60 `httpErr` existentes y los de los casos de uso para un beneficio que la expresión regular da gratis; queda como mejora si la convención se erosiona.
- **D-P4. `login` como caso de uso con `compare` inyectable.** Probar RF-12 midiendo milisegundos sería inestable en CI; verificar que la comparación se invoca en las tres ramas es determinista. *Descartado:* una prueba de tiempos con tolerancia — fallos intermitentes.
- **D-P5. Los límites por IP con `trust proxy` configurable.** *Descartado:* `keyGenerator` que lee `X-Forwarded-For` directamente — cualquier cliente que llegue directo al backend podría falsearlo; `trust proxy` de Express entiende cuántos saltos de confianza hay.
- **D-P6. Cabeceras de nginx por `include` en cada `location` estática.** La herencia de `add_header` en nginx es por bloque: un solo `add_header` en el `location` hijo descarta los del padre. *Descartado:* ponerlas a nivel `server` — se pierden silenciosamente en `/assets/` y se duplican en `/api/`.
- **D-P7. `apiServer` usa `createApp()` y cada llamada manda un `X-Forwarded-For` propio por defecto** (con `trust proxy` en 1): así los tests de una misma suite no comparten cupo de login ni de `/public/*`, que hoy es una dependencia oculta entre tests. *Descartado:* una variable para desactivar los límites en tests — es una puerta trasera de producción que existe solo para la suite.

## 6. Estrategia de tests (TDD, principio 9)

Orden: primero los casos **no obvios**; después el camino feliz. Todos los de integración usan `createApp()`.

### Unit (`node:test`, sin DB)
- `tests/infrastructure/errorHandler.test.js` — `toResponse`: error de aplicación 4xx pasa; mensaje con prosa o SQL → no pasa (`bad_request`/`internal_error`); `entity.parse.failed`, `entity.too.large`, `charset.unsupported`; error sin `status` y `status: 500` con mensaje SQL → exactamente `{ error: 'internal_error' }`; con `createErrorHandler({ log })` el log recibe la traza y `req.path` sin query, y **no** recibe cuerpo ni la query (`?token=…`). — RF-1, RF-2, RF-3
- `tests/infrastructure/config.test.js` — válidos e inválidos de RF-14: `JWT_SECRET` vacío / ausente, `TRUST_PROXY` `'uno'`, `'-1'`, `'1.5'`, `PORT` `'0'` y `'70000'`; en `production` secreto corto y secreto de ejemplo → error; en `development` con el de ejemplo → ok; el mensaje de error no contiene el secreto. — RF-14, RF-15, RF-10
- `tests/domain/passwords.test.js` — 7, 8 y 72 bytes; 73 bytes; multibyte (por ejemplo 40 caracteres de 2 bytes = 80 bytes → inválida); 8 espacios → válida; ausente → `missing_fields`; no string → `invalid_body`. — RF-11
- `tests/application/login.test.js` — `compare` espía invocado en: email inexistente, usuario `pendiente`, usuario `inactivo`, usuario sin hash y activo con clave mala; los cuatro lanzan 401 `invalid_credentials`; activo con clave buena devuelve el usuario; con `dummyHash` distinto de `password_hash` real. — RF-12
- `tests/application/inviteStaff.test.js` (ajustar) — se pasa `body`; nuevos: `body` `undefined`/`[]`/`null` → 400 `invalid_body` con **403 primero** si el actor es staff. — RF-4
- `tests/application/listPayments.test.js` / `getPaymentsSummary.test.js` (ampliar) — `employee_id: 'abc'` → vacío/ceros y ningún repositorio consultado. — RF-6
- `tests/application/createPayment.test.js` — con un repositorio que registra la concurrencia, nunca hay dos consultas simultáneas. — RF-20
- `tests/infrastructure/jwt.test.js` — token `alg: none`, token con otro secreto y token manipulado → `verifyToken` lanza; token propio ok. — RF-13

### Integración (Postgres real, `createApp()` sobre puerto efímero)
`tests/integration/hardening.test.js`:
1. **Recorrido de rutas**: por cada `[mount, router]` de `ROUTES` y cada `layer.route`, se sustituye cada `:param` por `abc`, se llama con un token de owner válido y se exige 404 (o 401 en las rutas de `public` con token) y que el cuerpo no contenga `select`, `Failed query` ni `password_hash`. Una ruta con parámetro no cubierto hace fallar el test. — RF-5, RF-7
2. `GET /availability/abc` **sin token** → 404 sin SQL. — RF-5
3. Filtros: `GET /appointments?employee_id=abc` → 400 `invalid_body`; `GET /payments?employee_id=abc` → 200 vacío. — RF-6
4. Error inesperado real: un repositorio forzado a lanzar con un mensaje SQL → 500 `internal_error` exacto. — RF-1
5. Parser: JSON roto → 400 `invalid_body`; cuerpo de 200 KB → 413; `charset=latin1` → 415; `text/plain` con cuerpo → 400 `invalid_body`. — RF-3
6. `POST /staff` sin cuerpo y con `[]` → 400 `invalid_body`; y `inputHardening` vuelve a verde. — RF-4
7. Límite de login: 10 fallos → el 11.º es 429 con `Retry-After`; un login correcto previo no cuenta; otra IP (`X-Forwarded-For` distinto con `trust proxy` 1) sigue pudiendo; con `trust proxy` 0 comparten el cupo. — RF-8, RF-10
8. Límite de registro: 5 correctos → el 6.º es 429. — RF-9
9. Contraseña: `register` con 7 → 400 `invalid_password`; con 8 → 201; `PATCH /me` con 3 → 400 `invalid_password`; activación de trabajador con 5 → 400. — RF-11
10. Cabeceras: `x-powered-by` ausente; las tres cabeceras presentes en 200, 404 y 500 de la API y en `/health`. — RF-16
11. Sin advertencia de `pg`: se captura `process.on('warning')` mientras se crea un turno pasado (con pago) dentro de la transacción y se corre `seedDemo`; no aparece ninguna con "already executing a query". — RF-20

### Verificación de infraestructura (manual, una vez; luego la hace la CI)
- `docker compose config -q`; con el entorno levantado, `curl -I` a `:5173/`, `:5173/assets/<archivo>` y `:5173/assets/nada.js`, y a `:5173/api/health`. El puerto `3000` responde desde `127.0.0.1` y **no** desde la IP de red de la máquina. 30 logins fallidos desde el frontend → 429 a partir del 11.º; enviar además un `-H "X-Forwarded-For: <otra IP>"` **no** da un cupo nuevo, porque nginx agrega la IP real al final de la cabecera y con `TRUST_PROXY=1` Express toma ese último valor. — RF-17, RF-18, RF-19
- Arrancar el backend con `JWT_SECRET=` vacío, `TRUST_PROXY=uno` y `NODE_ENV=production` con el secreto de ejemplo: los tres terminan con código distinto de cero sin abrir el puerto. — RF-14

### Gate
Backend: `npm test` (en `TZ=UTC` y `TZ=America/Santiago`) y `npm run db:migrate`. Frontend: `npm test`, `npm run lint`, `npm run build`, `npm run typecheck`. Todos antes de cada commit.

## 7. Mapa RF → módulo

| RF | Dónde se cubre |
|---|---|
| RF-1, RF-2, RF-3 | `errorHandler.js` (`toResponse`, `createErrorHandler`) |
| RF-4 | `inviteStaff` (`body` + `parseInput`) y `routes/staff.js` |
| RF-5, RF-7 | `uuidParams.js` + `createApp.js` (`ROUTES`) + test de recorrido |
| RF-6 | `listPayments` / `getPaymentsSummary` (rama vacía); `optionalUuid` ya existente para el resto |
| RF-8, RF-9 | `limiters.js` + `routes/auth.js` |
| RF-10 | `config.js` (`trustProxy`) + `createApp.js` + `apiServer` |
| RF-11 | `newPassword()` en `schemas/common.js` y su uso en `auth`, `public`, `staff` |
| RF-12 | `application/login.js` |
| RF-13 | `http/jwt.js` + `middleware/auth.js` |
| RF-14, RF-15 | `config.js` + `app.js` |
| RF-16 | `securityHeaders.js` + `createApp.js` |
| RF-17 | `frontend/security-headers.conf` + `nginx.conf` |
| RF-18, RF-19 | `docker-compose.yml` |
| RF-20 | `createPayment.js` |
| RF-21 | `LoginPage.tsx` |
| RF-22 | `package.json` (`typecheck`), `ci.yml` |
| RF-23 | `README.md` |

## 8. Verificación final

Repetir, contra el servidor real, las pruebas que detectaron los defectos (`GET /availability/abc`, `POST /staff` sin cuerpo, 30 logins fallidos, tiempo de login con email existente e inexistente, `curl -I` de backend y frontend) y confirmar que ninguna reproduce el problema.

## 9. Archivos tocados (resumen)

- **Nuevos:** `backend/src/application/login.js`, `backend/src/infrastructure/config.js`, `backend/src/infrastructure/http/{createApp.js,jwt.js}`, `backend/src/infrastructure/http/middleware/{uuidParams,securityHeaders,limiters}.js`, `frontend/security-headers.conf`, tests unit e integración.
- **Modificados:** `backend/src/infrastructure/http/{app.js,middleware/{errorHandler,auth}.js,routes/*.js}`, `application/{inviteStaff,createPayment,listPayments,getPaymentsSummary}.js`, `domain/schemas/{common,auth,public,staff}.js`, `tests/helpers/{apiServer,publicServer}.js`, `tests/application/inviteStaff.test.js`, `docker-compose.yml`, `frontend/{nginx.conf,package.json,src/pages/LoginPage.tsx}`, `.github/workflows/ci.yml`, `backend/.env.example`, `README.md`, `docs/diseno-gestor-turnos.md`.
