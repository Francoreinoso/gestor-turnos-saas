# Spec 008 — Endurecimiento de la API: errores seguros, límites de acceso y cabeceras

## Contexto y objetivo

Una revisión de lo entregado hasta la spec 007, probada contra el servidor real, encontró defectos de seguridad y robustez que impiden presentar el proyecto con confianza:

1. **Fuga de SQL sin autenticación.** Un identificador que no es UUID en una ruta (`GET /appointments/abc`, `/services/abc`, `/staff/abc`, …) llega a Postgres, falla y el manejador de errores devuelve el texto completo de la consulta —con los nombres de todas las columnas, incluido `password_hash`— con estado 500. `GET /availability/abc` es público: lo explota cualquiera.
2. **Los 500 devuelven `err.message`.** Cualquier error inesperado expone detalles internos. Además un JSON mal formado devuelve el mensaje del parser en lugar de un código.
3. **`POST /staff` sin cuerpo responde 500** y con `[]` responde `missing_fields` en vez de `invalid_body`: es la única ruta que no pasa por `parseInput` y por eso falla hoy el test `inputHardening` (RF-10 de la spec 007).
4. **Sin límite de intentos en `POST /auth/login`**: 30 contraseñas incorrectas seguidas devuelven 401 sin bloqueo.
5. **Los límites de `/public/*` no funcionan por persona detrás de nginx.** Express ignora `X-Forwarded-For` mientras `trust proxy` es `false`, así que en el Docker de la spec 006 todos los visitantes comparten la IP de nginx y un único cupo: la 21.ª reserva de la ventana de 15 minutos la rechaza el sistema para **cualquier** cliente.
6. **Enumeración de cuentas por tiempo de respuesta**: login responde en ~1 ms si el email no existe y en ~36 ms si existe (solo ahí corre `bcrypt`).
7. **Contraseñas de un carácter** aceptadas al registrar; `bcrypt` además trunca en silencio todo lo que pasa de 72 bytes.
8. `JWT_SECRET` no se valida al arrancar (falta → 500 recién al firmar), `X-Powered-By: Express` expuesto, y la respuesta con el enlace de gestión del cliente puede enviarse como `Referer` o quedar en caché.
9. `createPayment` lanza consultas en paralelo sobre el cliente de una transacción: `pg` ya emite una advertencia de deprecación (visible al correr el seed) y en `pg@9` dejará de funcionar.

Esta spec corrige todo lo anterior sin cambiar el contrato funcional de la API: no agrega endpoints y mantiene los códigos de error existentes, salvo las correcciones de 500 y los códigos nuevos de RF-3, RF-9 y RF-11.

## Usuarios / actores

- **Atacante anónimo**: sin credenciales; alcanza las rutas públicas y el login.
- **Usuario autenticado (owner o staff)**: puede enviar cualquier valor en rutas y filtros de su alcance.
- **Operador**: quien despliega; necesita que una configuración insegura falle al arrancar y no en producción.
- **Cliente final**: abre enlaces de gestión con el token en la URL.

## Glosario

- **Error de aplicación**: el que lanzan los casos de uso y las rutas con un código estable (`httpErr(status, 'codigo')`): estado 4xx y mensaje en `snake_case`.
- **Error inesperado**: cualquier otro (fallo de base, `TypeError`, error de librería): nunca debe llegar al cliente con su mensaje.
- **Código de error**: la cadena `{ "error": "<código>" }` uniforme de la API.
- **UUID válido**: el mismo criterio de `domain/uuid.js`.
- **Intento fallido de login**: una solicitud a `POST /auth/login` cuya respuesta es 4xx.

## Historias de usuario

- H1: Como operador quiero que ningún error exponga SQL, nombres de columnas ni trazas para que un atacante no aprenda del sistema.
- H2: Como usuario quiero que un id mal escrito me devuelva "no encontrado" y no un error del servidor.
- H3: Como owner quiero que adivinar mi contraseña por fuerza bruta sea impracticable.
- H4: Como operador quiero que los límites de uso se apliquen por cliente real, también detrás del proxy del frontend.
- H5: Como operador quiero que el servidor no arranque con una configuración insegura.
- H6: Como cliente final quiero que mi enlace de gestión no se filtre a terceros ni se guarde en cachés.

## Requisitos funcionales (criterios de aceptación en EARS)

### Errores seguros

- RF-1: CUANDO una solicitud produce un error inesperado, EL SISTEMA responde 500 `{ "error": "internal_error" }` sin ningún otro dato: ni mensaje, ni consulta SQL, ni traza, ni nombres de tabla o columna.
- RF-2: CUANDO ocurre un error inesperado, EL SISTEMA lo registra en el servidor con método, ruta **sin query string** y traza, y nunca registra cuerpos, cabeceras ni la query (puede contener el token de un enlace de gestión).
- RF-3: CUANDO ocurre un error con estado 4xx cuyo mensaje es un código (`snake_case`: minúsculas, dígitos y `_`), EL SISTEMA lo devuelve tal cual, con su estado. CUANDO es un error de librería, EL SISTEMA lo traduce a un código fijo: JSON mal formado → 400 `invalid_body`; cuerpo que excede el límite → 413 `payload_too_large`; tipo de contenido o codificación no soportados → 415 `unsupported_media_type`; cualquier otro 4xx cuyo mensaje no sea un código → su mismo estado con `bad_request`. El único código existente que no cumple la convención, `date_from, date_to, service_id required` de `GET /availability/:business_id` (spec 007 lo preservó como contrato), pasa a ser `missing_fields` con el mismo estado 400 (D11).
- RF-4: CUANDO el cuerpo de `POST /staff` no es un objeto (ausente, `null`, array, texto), EL SISTEMA responde 400 `invalid_body` y no 500; la validación pasa por el mismo `parseInput` que el resto de las rutas.

### Identificadores inválidos

- RF-5: CUANDO un parámetro de ruta que identifica un recurso (`:id`, `:business_id`) no es un UUID válido, EL SISTEMA responde como si el recurso no existiera —404 con el mismo código que ya devuelve para un id válido inexistente (`not_found` salvo donde la ruta ya usa otro)— sin consultar la base. Aplica a todas las rutas: `appointments`, `services`, `clients`, `staff` (incluido `/:id/availability`), `availability` y `accounts`. Las rutas públicas con token conservan su 401 (spec 005 RF-7).
- RF-6: CUANDO un filtro UUID de query o de cuerpo (`employee_id`, `service_id`, `client_id`, …) no es un UUID válido, EL SISTEMA responde 400 `invalid_body` —el código que ya usan los demás filtros UUID de la API— salvo en `GET /payments` y `GET /payments/summary`, donde la spec 003 (RF-4) define que un `employee_id` inexistente devuelve lista vacía y ceros: allí un valor no UUID se trata como inexistente (200, vacío).
- RF-7: EL SISTEMA no ofrece ninguna ruta con un parámetro de id que pueda terminar en 500 por un valor no UUID: una ruta futura sin esa guarda debe hacer fallar la suite (ver criterios de finalización).

### Acceso y credenciales

- RF-8: CUANDO una dirección IP acumula 10 intentos fallidos de login en una ventana de 15 minutos, EL SISTEMA responde 429 `too_many_requests` con cabecera `Retry-After` a los siguientes intentos de esa IP hasta que la ventana se renueve. Los logins exitosos no cuentan.
- RF-9: CUANDO una dirección IP envía más de 5 solicitudes a `POST /auth/register` en una hora, EL SISTEMA responde 429 `too_many_requests` a las siguientes.
- RF-10: MIENTRAS la variable `TRUST_PROXY` vale `N` (entero ≥ 0, por defecto 0), EL SISTEMA toma la IP del cliente de `X-Forwarded-For` descartando los `N` saltos de proxy de confianza más cercanos; con 0 ignora esa cabecera. Esto rige para todos los límites de uso (login, registro y `/public/*`). SI el valor no es un entero ≥ 0, ENTONCES EL SISTEMA no arranca (RF-14).
- RF-11: CUANDO se define una contraseña (`POST /auth/register`, activación de un trabajador, cambio propio en `PATCH /me`), EL SISTEMA exige entre 8 caracteres y 72 **bytes** en UTF-8; SI la contraseña está presente pero fuera de rango, ENTONCES responde 400 `invalid_password`. La ausencia sigue siendo `missing_fields`. El login no aplica esta regla (los usuarios existentes con contraseñas más cortas pueden seguir entrando).
- RF-12: CUANDO se intenta iniciar sesión, EL SISTEMA ejecuta una comparación `bcrypt` completa aunque el email no exista, el usuario no esté `activo` o no tenga contraseña, de modo que el tiempo de respuesta no distinga esos casos; la respuesta sigue siendo 401 `invalid_credentials` en todos.
- RF-13: EL SISTEMA firma y verifica los JWT con el algoritmo HS256 fijado explícitamente; un token con otro algoritmo (incluido `none`) se rechaza con 401.

### Configuración al arrancar

- RF-14: CUANDO el servidor arranca, EL SISTEMA valida su configuración y, si es inválida, termina con código distinto de cero y un mensaje que nombra la variable, sin abrir el puerto. Reglas: `JWT_SECRET` obligatorio y no vacío; `TRUST_PROXY` entero ≥ 0; `PORT` entero entre 1 y 65535 si está definido; con `NODE_ENV=production`, además, `JWT_SECRET` de al menos 32 caracteres y distinto de los valores de ejemplo del repositorio.
- RF-15: EL SISTEMA no incluye el valor de `JWT_SECRET` en ningún mensaje de error ni log de arranque.

### Cabeceras y exposición

- RF-16: EL SISTEMA no envía `X-Powered-By`, y todas las respuestas de la API (incluidas `/health` y las de error) llevan `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y `Cache-Control: no-store`.
- RF-17: EL SISTEMA sirve el frontend con `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` y `Referrer-Policy: no-referrer` en **todas** sus respuestas estáticas (incluidos `/assets/`, la ruta de respaldo a `index.html` y las respuestas de error), de modo que el token de un enlace de gestión no se envíe como `Referer` a otros sitios ni la aplicación pueda incrustarse en un marco. Las respuestas de `/api/` conservan las cabeceras del backend sin duplicarlas.
- RF-18: EL SISTEMA publica el puerto del backend de Compose solo en la interfaz local (`127.0.0.1`), de modo que desde fuera de la máquina el único camino a la API es el frontend, que fija la IP real del cliente (RF-10) y no puede saltearse con una cabecera `X-Forwarded-For` falsa.
- RF-19: EL SISTEMA configura `TRUST_PROXY=1` para el backend en Compose, con un comentario que explica por qué.

### Robustez interna

- RF-20: CUANDO un caso de uso ejecuta consultas dentro de una transacción, EL SISTEMA no las lanza en paralelo sobre el mismo cliente (`createPayment` deja de usar `Promise.all` sobre la transacción); ejecutar el seed y crear un turno pasado no emite la advertencia de `pg` sobre consultas concurrentes.

### Pantalla de acceso y verificación continua

- RF-21: CUANDO la API responde `too_many_requests` o `invalid_password`, EL SISTEMA muestra en la pantalla de acceso un mensaje en español específico ("Demasiados intentos. Esperá unos minutos e intentá de nuevo." / "La contraseña debe tener entre 8 y 72 caracteres.") y no el código crudo; el campo de contraseña del registro declara `minLength=8`.
- RF-22: EL SISTEMA agrega a la CI una verificación de tipos del frontend (`tsc --noEmit`) y comprueba, en la prueba de humo, las cabeceras de RF-17 con una solicitud real al frontend.
- RF-23: EL README refleja el estado de seguridad real: qué protege el sistema ahora (límites, errores genéricos, cabeceras, validación de configuración) y qué queda fuera (RF de "Fuera de alcance").

## Requisitos no funcionales

- Sin dependencias nuevas: los límites usan `express-rate-limit` (ya presente) y las cabeceras se fijan con un middleware propio de pocas líneas.
- El comportamiento de los límites y de las cabeceras es el mismo detrás de nginx y con acceso directo al backend en desarrollo.
- Los límites son contadores en memoria por proceso (como el de `/public/*` hoy); no se promete coherencia entre varias réplicas.
- Idioma de mensajes y documentación: español; los códigos de error no se traducen.

## Notas de arquitectura

- El manejador de errores y la regla "código vs. mensaje" (RF-3) viven en `infrastructure/http/middleware/errorHandler.js` y se prueban como función pura; el único lugar que distingue error de aplicación de error inesperado.
- La guarda de UUID (RF-5) es un middleware de parámetros reutilizable aplicado a cada router de recursos, no una validación repetida en cada ruta; `domain/uuid.js` ya contiene la regla.
- La configuración (RF-14) se carga una vez en un módulo propio de `infrastructure/` que recibe el entorno como argumento (testeable sin tocar `process.env`); `app.js` es el único que lo invoca al arrancar, por lo que los tests de rutas no se ven afectados.
- El login pasa a un caso de uso (`application/login.js`) con la comparación `bcrypt` y la firma del token inyectables: es la única forma de probar RF-12 sin medir milisegundos.
- Los límites de RF-8, RF-9 y los de `/public/*` se construyen con una fábrica que acepta el tope y la ventana, para probarlos con valores chicos.
- La política de contraseña es una regla de **forma** y vive en un esquema Zod compartido (spec 007), no en los casos de uso.

## Casos límite

- `GET /availability/abc` sin autenticación → 404, nunca SQL (RF-5).
- `GET /staff/abc/availability` con token de owner → 404 sin consultar la base (RF-5).
- `GET /payments?employee_id=abc` → 200 con listado vacío, igual que un `employee_id` inexistente (RF-6).
- `GET /appointments?employee_id=abc` → 400 `invalid_body` (RF-6).
- JSON mal formado → 400 `invalid_body`; cuerpo de 200 KB → 413 `payload_too_large`; `Content-Type: application/json; charset=latin1` → 415 `unsupported_media_type`; `Content-Type: text/plain` con cuerpo → el parser lo ignora y el endpoint responde 400 `invalid_body` por cuerpo ausente. En ningún caso aparece el mensaje del parser (RF-3).
- 11.º intento fallido de login desde la misma IP → 429; el 11.º desde otra IP → 401 (RF-8, RF-10).
- Diez logins fallidos y uno correcto → el correcto entra mientras no se haya alcanzado el tope; alcanzado, responde 429 aunque la clave sea correcta (comportamiento esperado del bloqueo por IP).
- Contraseña de 72 caracteres ASCII → válida; de 40 caracteres con acentos que superan 72 bytes → 400 `invalid_password` (RF-11).
- Contraseña de solo espacios de largo 8 → válida (no se recorta; es decisión del usuario).
- Usuario `pendiente` o `inactivo` y email inexistente → mismo 401 y misma comparación `bcrypt` (RF-12).
- `JWT_SECRET=""` → no arranca; `TRUST_PROXY=uno` → no arranca; `PORT=0` → no arranca (RF-14).
- `NODE_ENV=production` con el secreto de ejemplo → no arranca; en `development` con ese mismo valor → arranca (la demo de Compose es de desarrollo).
- Detrás de nginx, dos clientes con IP distinta en `X-Forwarded-For` tienen cupos separados; con `TRUST_PROXY=0` comparten el cupo de la IP del socket (RF-10).
- Un cliente que alcanza directamente el puerto del backend en `127.0.0.1` con un `X-Forwarded-For` falso solo afecta su propio cupo (RF-18).
- Respuesta de error 404 del frontend estático → lleva las cabeceras de RF-17.

## Fuera de alcance

- Cambiar la duración del JWT (7 días), refresh tokens, revocación general de sesiones y cierre de sesión en el servidor.
- Recuperación de contraseña, verificación de email, doble factor y CAPTCHA.
- Bloqueo por cuenta (se descarta: permite a un tercero dejar fuera al dueño legítimo, ver D3).
- `Content-Security-Policy` y `Strict-Transport-Security`: la primera no puede verificarse sin ejecutar nginx y el navegador en la CI; la segunda pertenece al terminador TLS de producción. Quedan como pendiente documentado.
- CORS: no se habilita; frontend y API comparten origen por el proxy (D5).
- Límite global para toda la API autenticada, `helmet`, logging estructurado (`pino`) y trazabilidad por id de solicitud.
- Compartir los contadores entre réplicas (Redis u otro almacén).
- Pantallas del panel y activación de trabajadores (spec 009).
- Notificaciones y zonas horarias.

## Criterios de finalización

- Cada RF con test automatizado. Se priorizan los casos no obvios:
  1. **Ninguna ruta con un parámetro de id responde 500 ante un valor no UUID**: la prueba recorre las rutas registradas de todos los routers (no una lista a mano), sustituye cada parámetro de id por `abc` y exige 404 sin SQL en el cuerpo; una ruta nueva sin guarda hace fallar la suite (RF-5, RF-7).
  2. **Ningún error inesperado filtra detalles**: un error provocado (repositorio que lanza con un mensaje SQL) responde exactamente `{ "error": "internal_error" }` y el log lo contiene con traza pero sin la query string (RF-1, RF-2).
  3. Errores de librería traducidos: JSON roto, cuerpo grande, tipo no soportado (RF-3).
  4. `POST /staff` sin cuerpo y con `[]` → 400 `invalid_body`; `inputHardening` vuelve a verde (RF-4).
  5. Límites: el 11.º fallo de login se bloquea, los exitosos no cuentan, IPs distintas con `TRUST_PROXY=1` tienen cupos separados y con `0` comparten, y `Retry-After` está presente (RF-8..RF-10).
  6. Contraseña: bordes de 7, 8 y 72 bytes y un caso multibyte (RF-11).
  7. Login: la comparación `bcrypt` se invoca en las tres ramas (inexistente, no activo, activo con clave mala) (RF-12).
  8. Token con algoritmo `none` o firmado con otro secreto → 401 (RF-13).
  9. La configuración inválida no arranca y no imprime el secreto (RF-14, RF-15).
  10. Cabeceras presentes en respuestas OK y de error del backend, y ausencia de `X-Powered-By` (RF-16); las del frontend en la prueba de humo (RF-17, RF-22).
  11. Crear un turno pasado y correr el seed no emiten la advertencia de `pg` (se captura `process.on('warning')`) (RF-20).
- `npm test` y `npm run db:migrate` del backend (en `TZ=UTC` y `TZ=America/Argentina/Buenos_Aires`), y `npm test`, `npm run lint`, `npm run build` y la verificación de tipos del frontend, en verde.
- Demo manual contra el servidor real: repetir las pruebas que detectaron los defectos —`GET /availability/abc`, `POST /staff` sin cuerpo, 30 logins fallidos, medición de tiempo de login con email existente e inexistente, `curl -I` del backend y del frontend— y confirmar que cada una ya no reproduce el problema.

## Dudas abiertas

- **Q1** — ¿Se aceptan los topes propuestos? Login: 10 intentos fallidos cada 15 minutos por IP; registro: 5 por hora por IP; contraseña: de 8 caracteres a 72 bytes. Son defendibles para una aplicación pequeña, pero un negocio con varios empleados detrás de una misma IP (la oficina) podría acercarse al tope de login si varios se equivocan a la vez. Se propone mantenerlos y que el tope sea configurable por variable de entorno en una spec posterior si hace falta.
- **Q2** — ¿Se adopta un mínimo de 8 caracteres también para el cambio de contraseña propio y la activación de trabajadores, o solo para el registro? Se propone los tres (RF-11): una política que solo vale en una puerta de entrada no protege.

## Registro de decisiones

- **D1** — El manejador de errores deja pasar solo mensajes con forma de código (RF-3) en lugar de una lista de errores "seguros": es una regla que se verifica con una expresión regular y que falla hacia el lado seguro; un error nuevo con un mensaje en prosa se traduce solo.
- **D2** — La guarda de UUID es un middleware compartido y una prueba que recorre las rutas registradas (criterio 1): la clase de defecto ("una ruta nueva olvidó validar el id") se detecta automáticamente en lugar de depender de la memoria de quien agregue la ruta.
- **D3** — El límite de login es por IP y no por cuenta: un bloqueo por cuenta permitiría a cualquiera dejar fuera al dueño legítimo con intentos deliberadamente fallidos. Se acepta que un atacante con muchas IPs lo eluda; el costo de `bcrypt` y la política de contraseñas son la segunda barrera.
- **D4** — `TRUST_PROXY` configurable (default 0) y backend de Compose solo en `127.0.0.1` (RF-18, RF-19): con la confianza activada, un cliente que llegara directo al backend podría falsear su IP; no publicar el puerto hacia afuera elimina ese camino sin cambiar el desarrollo local.
- **D5** — No se habilita CORS: el frontend y la API comparten origen vía proxy (Vite en desarrollo, nginx en Docker). Abrirlo sin necesidad ampliaría la superficie.
- **D6** — Cabeceras con un middleware propio y no con `helmet`: para una API que solo devuelve JSON, casi todo `helmet` (CSP, COEP, HSTS) es irrelevante o pertenece al terminador TLS; tres cabeceras y `x-powered-by` no justifican una dependencia nueva (constitución, principios 1 y 11).
- **D7** — La comparación `bcrypt` ficticia (RF-12) usa un hash válido generado con el mismo costo que los reales (10, el de `routes/auth.js`), calculado una vez al cargar el módulo: un hash inventado de otro costo no igualaría los tiempos.
- **D8** — Se mide la longitud de la contraseña en **bytes** (RF-11): `bcrypt` trunca en 72 bytes, y contarlos en caracteres permitiría contraseñas largas cuyo final no se compara.
- **D9** — `payments` mantiene "inexistente → vacío" para un `employee_id` no UUID (RF-6) por coherencia con la spec 003; cambiar ese contrato a 400 es una decisión de producto que no corresponde a una spec de endurecimiento.
- **D10** — Se difiere `Content-Security-Policy`: verificar que una política no rompe la aplicación exige un navegador real (carga de scripts y estilos, y las llamadas a `/api`), que la CI de este repositorio no ejecuta; una CSP mal puesta falla en silencio en producción y se detecta recién en uso. Queda como pendiente documentado en el README.
- **D11** — El código `date_from, date_to, service_id required` (prosa con espacios, heredado y preservado por la spec 007 como "contrato público") se reemplaza por `missing_fields`: ningún consumidor lo usa (el frontend solo envía esas fechas y ya traduce `missing_fields`), y mantenerlo obligaría a una excepción en el manejador de errores que anula la regla "código = `snake_case`" (D1). Es el único cambio de contrato de esta spec; los tests que lo fijaban se actualizan.
