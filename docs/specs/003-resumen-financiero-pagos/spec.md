# Spec 003 — Resumen financiero y consulta de pagos

## Contexto y objetivo

El sistema ya calcula y registra pagos y comisiones automáticamente al
completar un turno, pero hoy no existe ninguna forma de consultarlos: el
owner no puede saber cuánto facturó el negocio ni cuánto generó cada
profesional, y un trabajador no puede ver sus propias comisiones ganadas.
Esta spec define un endpoint de solo lectura que expone ese resumen
agregado por período y el detalle de los pagos que lo componen, con
visibilidad distinta según el rol, y garantiza que los resúmenes de
períodos ya pasados no cambien salvo dentro de una ventana corta de
corrección.

## Usuarios / actores

- **Owner**: consulta el resumen financiero completo de su cuenta (total
  del negocio y desglose por cada profesional, incluyendo lo que cada uno
  le dejó al negocio) y el listado detallado de pagos, con filtros de
  período y de profesional.
- **Staff (trabajador)**: consulta únicamente su propio resumen de
  comisiones ganadas y su propio listado de pagos, con los mismos filtros
  de período. Ve el detalle completo de sus propios pagos (incluido lo
  que cada uno le dejó al negocio), pero nunca el total consolidado del
  negocio ni los datos de otro profesional.

## Glosario

- **Período**: rango de fechas sobre el que se agregan los pagos,
  indicado con un preset (`hoy`, `esta_semana`, `este_mes`) o con un rango
  libre (`date_from`/`date_to`). Se determina por la fecha/hora agendada
  del turno asociado a cada pago (`scheduled_at`), no por la fecha en que
  se registró el pago. Los cortes se calculan en UTC.
- **Resumen (agregado)**: monto total facturado, monto total
  correspondiente a los profesionales, monto total correspondiente al
  negocio, cantidad de pagos y desglose por profesional, agregados sobre
  un período.
- **Listado detallado**: los pagos individuales que componen el resumen,
  cada uno con su turno, su profesional y sus montos, ordenados por la
  fecha/hora del turno.
- **Pago de "contrato fijo"**: pago cuyo profesional asignado no tiene
  comisión propia y la cuenta tampoco tiene una comisión por defecto
  definida. Representa un profesional que cobra por fuera de este sistema
  (sueldo fijo); el pago se cuenta en la facturación total pero no se
  reparte entre profesional y negocio.

## Historias de usuario

- H1: Como owner quiero ver el total facturado por mi negocio en un
  período, con el desglose por profesional, para conocer mi desempeño
  financiero y el de mi equipo en una sola consulta.
- H2: Como owner quiero listar los pagos individuales de un período,
  filtrando por profesional, para auditar el detalle detrás de los
  totales.
- H3: Como trabajador quiero ver mi propio resumen de comisiones ganadas
  en un período, con el detalle de cada pago, para saber cuánto me
  corresponde cobrar.
- H4: Como owner quiero que el resumen de un período ya cerrado no cambie
  más allá de una ventana corta de corrección, para poder confiar en los
  reportes que ya consulté.

## Requisitos funcionales (criterios de aceptación en EARS)

### Resumen agregado — owner

- RF-1: CUANDO el owner solicita el resumen financiero de un período, EL
  SISTEMA devuelve, en la misma respuesta, el monto total facturado, el
  monto total correspondiente a los profesionales, el monto total
  correspondiente al negocio, la cantidad de pagos y el desglose por cada
  profesional con al menos un pago en el período (salida 200).
- RF-2: EL SISTEMA incluye, para cada profesional del desglose, el monto
  total que generó, el monto que le corresponde a él y el monto que le
  dejó al negocio.
- RF-3: DONDE el owner indica un filtro de profesional, EL SISTEMA
  restringe el resumen (desglose reducido a ese único profesional) y el
  listado a los pagos de ese profesional únicamente.
- RF-4: SI el owner filtra por un profesional que no pertenece a su
  cuenta, o que no existe, ENTONCES EL SISTEMA devuelve un resumen en
  cero y un listado vacío, sin error — mismo tratamiento para ambos
  motivos, sin distinguirlos.
- RF-5: SI un pago no tiene comisión resuelta (ni el profesional ni la
  cuenta tienen una tasa definida — "contrato fijo"), ENTONCES EL SISTEMA
  lo cuenta en el monto total facturado y en el monto generado por su
  profesional asignado dentro del desglose, pero no lo suma al monto
  total de profesionales ni al del negocio.

### Resumen agregado — staff

- RF-6: CUANDO un trabajador solicita su propio resumen financiero de un
  período, EL SISTEMA devuelve el monto total que generó, el monto que le
  corresponde a él, el monto que le dejó al negocio en ese período y la
  cantidad de pagos (salida 200).
- RF-7: EL SISTEMA nunca devuelve a un trabajador el total consolidado
  del negocio (agregado de todos los profesionales de la cuenta) ni los
  montos de otro profesional, sin importar los filtros indicados en la
  solicitud — igual que en el listado de turnos, donde el filtro de
  empleado de un staff se ignora y se fuerza siempre a su propio id.

### Listado detallado

- RF-8: CUANDO el owner o un trabajador solicita el listado detallado de
  pagos de un período, EL SISTEMA devuelve cada pago con el turno
  asociado, el profesional, el monto total, el monto del profesional y el
  monto del negocio, ordenados por la fecha/hora del turno, del más
  reciente al más antiguo.
- RF-9: EL SISTEMA aplica al listado detallado los mismos filtros de
  período y de profesional, y las mismas restricciones de alcance por
  rol, que al resumen agregado (RF-3, RF-4, RF-7); en particular, el
  listado de un trabajador solo contiene sus propios pagos, por lo que
  incluir en cada fila el monto que le dejó al negocio no expone datos de
  otro profesional ni el consolidado del negocio.
- RF-10: EL SISTEMA limita el listado detallado a un máximo de resultados
  por solicitud, igual que el listado de turnos; SI el período tiene más
  pagos que ese máximo, ENTONCES devuelve los más recientes hasta el
  límite e indica que existen más pagos no incluidos en la respuesta. El
  resumen agregado (RF-1, RF-6) no se ve afectado por este límite: sus
  totales siempre reflejan todos los pagos del período, se muestren o no
  en el listado.

### Filtro de período

- RF-11: EL SISTEMA reconoce como filtro de período los presets `hoy`,
  `esta_semana` (lunes a domingo) y `este_mes`, además de un rango libre
  indicado con `date_from`/`date_to`.
- RF-12: SI no se indica ningún filtro de período, ENTONCES EL SISTEMA usa
  `este_mes` como valor por defecto.
- RF-13: SI se indica un preset y un rango libre en la misma solicitud,
  ENTONCES EL SISTEMA rechaza la solicitud (salida 400) por ambigüedad.
- RF-14: EL SISTEMA calcula los límites de cada preset en UTC de la
  siguiente forma: `hoy` abarca desde las 00:00:00.000 hasta las
  23:59:59.999 UTC del día calendario actual; `esta_semana` abarca desde
  las 00:00:00.000 UTC del lunes hasta las 23:59:59.999 UTC del domingo
  de la semana calendario actual; `este_mes` abarca desde las
  00:00:00.000 UTC del primer día hasta las 23:59:59.999 UTC del último
  día del mes calendario actual.
- RF-15: EL SISTEMA trata `date_from` y `date_to` del rango libre como
  límites inclusivos.
- RF-16: EL SISTEMA filtra y ordena los pagos según la fecha/hora
  agendada del turno asociado (`scheduled_at`), nunca según la fecha en
  que se registró el pago.
- RF-17: SI el rango libre indicado tiene `date_from` posterior a
  `date_to`, ENTONCES EL SISTEMA devuelve un resumen en cero y un listado
  vacío, sin error — igual que el criterio ya usado en el listado de
  turnos.
- RF-18: SI el preset o las fechas del rango libre indicados son
  inválidos, ENTONCES EL SISTEMA rechaza la solicitud (salida 400).

### Estabilidad de períodos cerrados

- RF-19: SI se solicita corregir un turno de `completado` a `no_llego`, o
  de `no_llego` a `completado`, y ya pasaron las 23:59:59.999 UTC del día
  calendario siguiente al día del turno (según `scheduled_at`), ENTONCES
  EL SISTEMA rechaza la corrección (salida 422).
- RF-20: EL SISTEMA permite la corrección `completado ↔ no_llego`, en
  cualquiera de los dos sentidos, sin restricción de tiempo mientras
  ocurra dentro de la ventana de RF-19 (el mismo día del turno o el día
  calendario siguiente, en UTC).

### Alcance y autorización

- RF-21: EL SISTEMA identifica siempre la cuenta y el rol del solicitante
  a partir del JWT, nunca del query string.
- RF-22: El endpoint de consulta de esta spec no crea, modifica ni
  elimina pagos; es exclusivamente de lectura. La única escritura
  relacionada es el rechazo de una corrección tardía (RF-19), que ocurre
  en la ruta de corrección de turnos ya existente, no en este endpoint.

## Requisitos no funcionales

- Toda operación exige JWT válido y que el usuario referenciado siga
  `activo`, igual que el resto de la plataforma.
- Los montos devueltos son los ya calculados y almacenados al completar
  cada turno (`employee_amount`/`business_amount`); este endpoint no
  recalcula comisiones, solo agrega datos existentes.
- Formato de error uniforme con el resto de la API: `{ "error": "<código>" }`.
- Idioma de mensajes y documentación: español.

## Casos límite

- Período sin ningún pago registrado → resumen en cero (todos los montos
  en 0, cantidad de pagos en 0, desglose vacío) y listado vacío, sin
  error.
- Owner filtra por un profesional que no pertenece a su cuenta, o que no
  existe → resultado vacío (200) en ambos casos, sin distinguir motivo;
  excepción deliberada al criterio general de la constitución ("recurso
  fuera de alcance → 404"), porque es un filtro de listado y no el acceso
  a un recurso puntual — mismo precedente que el listado de turnos.
- Staff intenta forzar el filtro de profesional a otro id, o pedir el
  consolidado del negocio, vía query string → se ignora, siempre ve lo
  suyo (RF-7).
- Preset y rango libre en la misma solicitud → 400 (RF-13).
- Rango libre invertido (`date_from` > `date_to`) → vacío, no error
  (RF-17), igual que en el listado de turnos.
- Profesional dado de baja (`inactivo`) con pagos históricos → sus pagos
  pasados siguen apareciendo en el resumen y el listado del owner (los
  pagos no se borran al dar de baja a un trabajador).
- Pago de "contrato fijo" (sin comisión resuelta) → cuenta en el total
  facturado y en el total generado del profesional en el desglose; no se
  reparte entre profesional y negocio (RF-5).
- Listado detallado que supera el máximo de resultados → se cortan los
  más recientes e indica que hay más; el resumen agregado no cambia
  (RF-10).
- Corrección `completado→no_llego` o `no_llego→completado` intentada más
  de un día calendario UTC después del turno → 422 en ambos sentidos
  (RF-19, RF-20).
- Servicio con precio $0 (pago de monto $0) → cuenta igual como pago
  normal, sin exclusión especial.

## Fuera de alcance

- Registrar, editar o anular pagos manualmente — este endpoint es
  exclusivamente de lectura; los pagos se siguen generando solo
  automáticamente al completar un turno (spec ya existente).
- Método de pago y moneda — no existen en el modelo de pagos y no se
  agregan en esta spec.
- Zona horaria configurable por cuenta — los cortes de período usan UTC
  fijo.
- Un campo o concepto explícito de "tipo de empleo" (contrato fijo vs.
  comisión) en el modelo de datos — se infiere solo por la ausencia de
  comisión resuelta en un pago puntual (RF-5), no se agrega ningún campo
  nuevo a `users` ni a `accounts`.
- Exportación a CSV/PDF o cualquier formato distinto de la respuesta de
  la API.
- Gráficos, series de tiempo o visualizaciones — solo datos agregados y
  de detalle en crudo.
- Snapshot histórico del precio del servicio al momento del turno — el
  pago ya usa el precio vigente al completar el turno (comportamiento
  preexistente que esta spec no modifica).
- Paginación por cursor — se reutiliza el mismo límite simple ya usado en
  el listado de turnos, con un indicador de "hay más" (RF-10), no cursor.
- Historial o auditoría de qué corrección se hizo y cuándo — RF-19 solo
  bloquea la corrección fuera de ventana, no registra un log de cambios.
- Extender la ventana de corrección de RF-19 a otras transiciones de
  turno distintas de `completado ↔ no_llego`.

## Notas de arquitectura

- `employee_amount` y `business_amount` ya están precalculados y
  almacenados por pago al completarse el turno — el resumen es una
  agregación (suma/agrupación) sobre datos existentes, no requiere
  recalcular comisiones ni tocar `resolveCommission`. El comportamiento
  de `resolveCommission` ante comisión no resuelta (`rate`, `employee_amount`
  y `business_amount` en `null`) ya está decidido y testeado
  (`resolveCommission.test.js`, commit `8579c13`) — RF-5 solo define cómo
  se agregan esos pagos en el resumen, no cambia cómo se calculan o
  almacenan.
- Al usar UTC fijo no se requiere ninguna migración de schema para el
  resumen en sí.
- RF-16 (filtro y orden por `scheduled_at`) implica que el resumen y el
  listado necesitan el turno asociado a cada pago, no solo la fila de
  `payments` — la agregación ya no es puramente sobre `payments`.

## Impacto fuera de esta spec (se resuelve en el plan de implementación)

- RF-19 y RF-20 modifican el comportamiento existente de
  `PATCH /appointments/:id/correct` (spec 001): hoy esa ruta permite
  corregir `completado ↔ no_llego` sin límite de tiempo. Esta spec agrega
  la ventana de un día calendario UTC como requisito nuevo sobre una ruta
  que no es propia de este endpoint de solo lectura.

## Criterios de finalización

- Cada RF con test automatizado. Se priorizan los casos no obvios sobre
  el CRUD trivial:
  1. Resumen agregado del owner, con desglose por profesional en la
     misma respuesta (RF-1, RF-2).
  2. Pago de "contrato fijo" (sin comisión resuelta): cuenta en
     facturado y en generado del profesional, no en profesional/negocio
     (RF-5).
  3. Staff nunca puede ver el consolidado del negocio ni el de otro
     profesional, aunque lo pida explícitamente por query string (RF-7);
     sí ve el monto al negocio de sus propios pagos en el listado (RF-9).
  4. Filtro por profesional fuera de la cuenta y por profesional
     inexistente → mismo resultado vacío en ambos casos (RF-4).
  5. Preset + rango libre simultáneos → 400 (RF-13); rango invertido →
     vacío (RF-17).
  6. Default de período (`este_mes`) cuando no se indica ninguno (RF-12);
     límites exactos de cada preset (RF-14).
  7. Filtro y orden por `scheduled_at`, no por la fecha de registro del
     pago (RF-16).
  8. Listado que supera el máximo: corta e indica que hay más, sin que
     cambie el resumen agregado (RF-10).
  9. Corrección `completado↔no_llego` dentro de la ventana (permitida) y
     fuera de la ventana, en ambos sentidos → 422 (RF-19, RF-20).
- `npm test` en verde.
- Demo manual: owner consulta el resumen del mes con desglose por
  profesional → filtra por un profesional específico → staff de ese
  profesional consulta su propio resumen y ve los mismos montos que le
  corresponden a él → staff intenta forzar el filtro a otro compañero (se
  ignora) → se intenta corregir un turno completado de hace tres días a
  `no_llego` (rechazado, 422).

## Dudas abiertas

- Ninguna.

## Registro de decisiones

- **D1** — Alcance de datos: resumen agregado **y** listado detallado,
  ambos en esta spec, siempre en la misma respuesta para el resumen
  (nunca modos separados).
- **D2** — Roles: el owner ve el negocio completo; el staff ve
  exclusivamente su propio resumen y listado, sin excepción por filtros
  de query string; el staff sí ve el detalle completo (incluido el monto
  al negocio) de sus propios pagos.
- **D3** — El owner puede desglosar y filtrar por profesional específico;
  el desglose incluye, por profesional, lo generado, lo propio y lo que
  dejó al negocio.
- **D4** — Filtro de período: presets (`hoy`/`esta_semana`/`este_mes`) más
  rango libre (`date_from`/`date_to`); por defecto `este_mes` si no se
  indica nada; límites exactos en UTC (RF-14); rango libre inclusivo en
  ambos extremos.
- **D5** — Zona horaria: UTC fijo, sin agregar campo de timezone a
  `accounts` (evita migración de schema en esta spec).
- **D6** — Método de pago y moneda: fuera de alcance; el modelo de
  `payments` no cambia.
- **D7** — El período y el orden del listado se determinan por
  `scheduled_at` del turno, no por `created_at` del pago.
- **D8** — Pagos sin comisión resuelta ("contrato fijo"): cuentan en el
  total facturado y en el total generado del profesional en el desglose,
  pero no se reparten entre profesional y negocio; sin campo nuevo en el
  modelo. No cambia el cálculo ya existente de `resolveCommission`.
- **D9** — Estabilidad de períodos cerrados: la corrección
  `completado ↔ no_llego`, en ambos sentidos, se bloquea (422) pasado el
  día calendario UTC siguiente al turno. Modifica una ruta existente de
  la spec 001 (ver "Impacto fuera de esta spec").
- **D10** — Filtro por profesional que no pertenece a la cuenta o que no
  existe: mismo tratamiento (200, resultado vacío), sin distinguir el
  motivo; excepción documentada al criterio general de 404 de la
  constitución, por tratarse de un filtro de listado.
- **D11** — Límite del listado detallado: corta en silencio en los más
  recientes e indica que hay más pagos no incluidos; el resumen agregado
  nunca se ve afectado por este límite.

## Notas posteriores

- **[spec 010](../010-agenda-y-pagos-en-panel/spec.md), D2 (sobre RF-12 y RF-14):** los presets siguen definidos en UTC, sin cambios en el contrato. Las pantallas de pagos no los usan: calculan el período en el día local del navegador y lo envían como rango libre (RF-15).
- **[spec 010](../010-agenda-y-pagos-en-panel/spec.md), RF-1 (sobre RF-19 y RF-20):** `PATCH /appointments/:id/correct` aplica el alcance por rol de la spec 001: un staff que corrige un turno ajeno, o un bloqueo de negocio, recibe 404 antes de evaluar la transición o la ventana. La ventana de corrección conserva su definición en UTC (D3).
- **[spec 010](../010-agenda-y-pagos-en-panel/spec.md), RF-23:** cada fila de `GET /payments` suma `clientName` y `serviceName` (campos nuevos, aditivos) para que el detalle muestre cliente y servicio.
