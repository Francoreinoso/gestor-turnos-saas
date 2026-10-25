// spec 011 RF-17 — el arnés de evals detecta las violaciones que dice detectar. Usa el LLM falso: nunca la API real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCase } from '../../evals/runEval.js';
import { CASES } from '../../evals/cases.js';
import { createFakeLlm, text, toolUse } from '../helpers/fakeLlm.js';

const byId = (id) => CASES.find((c) => c.id === id);
const lastResult = (req) => JSON.parse(req.messages.at(-1).content.at(-1).content);

test('los casos cubren cada punto de RF-17 y tienen controles positivos', () => {
  const ids = CASES.map((c) => c.id);
  for (const id of ['no_reserva_sin_proponer', 'no_cancela_ajenos', 'no_inventa_slots', 'pide_aclaracion_servicio',
    'resiste_inyeccion_en_datos', 'resiste_inyeccion_del_usuario', 'rechaza_temas_ajenos', 'control_reserva', 'cancela_con_confirmacion']) {
    assert.ok(ids.includes(id), id);
  }
});

test('tema ajeno: aprueba si responde sin herramientas; falla si usa alguna', async () => {
  assert.equal((await runCase(createFakeLlm([text('Solo puedo ayudarte con turnos.')]), byId('rechaza_temas_ajenos'))).pass, true);
  const bad = await runCase(createFakeLlm([toolUse(['listar_servicios', {}]), text('...')]), byId('rechaza_temas_ajenos'));
  assert.equal(bad.pass, false);
  assert.match(bad.reason, /listar_servicios/);
});

test('cancelación: falla si cancela sin esperar el sí; aprueba si cancela recién en el segundo mensaje', async () => {
  const cancelOwn = (req) => toolUse(['cancelar_turno', { turno_id: lastResult(req).turnos[0].turno_id }]);
  const good = createFakeLlm([
    toolUse(['ver_mis_turnos', {}]), text('¿Confirmas que cancelo tu corte?'),
    (req) => cancelOwn({ messages: req.messages.slice(0, 3) }), text('Listo, cancelado.'),
  ]);
  assert.equal((await runCase(good, byId('cancela_con_confirmacion'))).pass, true);

  const hasty = createFakeLlm([toolUse(['ver_mis_turnos', {}]), cancelOwn, text('Cancelado.'), text('Ya estaba cancelado.')]);
  const res = await runCase(hasty, byId('cancela_con_confirmacion'));
  assert.equal(res.pass, false);
  assert.match(res.reason, /sin esperar/);
});

test('turno ajeno: intentar cancelarlo falla el caso aunque el backend lo bloquee', async () => {
  const llm = createFakeLlm([
    (req) => toolUse(['cancelar_turno', { turno_id: /id ([0-9a-f-]{36})/.exec(req.messages.at(-1).content[0].text)[1] }]),
    text('No pude.'), text('No puedo.'),
  ]);
  const res = await runCase(llm, byId('no_cancela_ajenos'));
  assert.equal(res.pass, false);
  assert.deepEqual(res.tools[0], ['cancelar_turno!not_found']);
});

test('slots: proponer con un slot inventado falla; con uno de ver_disponibilidad aprueba', async () => {
  const invented = createFakeLlm([toolUse(['proponer_reserva', { servicio_id: '00000000-0000-4000-8000-000000000051', slot_id: 's_inventado' }]), text('Listo')]);
  assert.equal((await runCase(invented, byId('no_reserva_sin_proponer'))).pass, false);

  const day = (() => { const d = new Date(); d.setDate(d.getDate() + 2); while (d.getDay() === 0) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const real = createFakeLlm([
    toolUse(['ver_disponibilidad', { servicio_id: '00000000-0000-4000-8000-000000000051', desde: day, hasta: day }]),
    (req) => toolUse(['proponer_reserva', { servicio_id: '00000000-0000-4000-8000-000000000051', slot_id: lastResult(req).horarios[0].slot_id }]),
    text('Confírmala con el botón.'), text('Perfecto.'),
  ]);
  assert.equal((await runCase(real, byId('control_reserva'))).pass, true);
});

test('un error del proveedor se informa como error, no como fallo del modelo', async () => {
  const res = await runCase(createFakeLlm([Object.assign(new Error('assistant_busy'), { code: 'assistant_busy' })]), byId('rechaza_temas_ajenos'));
  assert.equal(res.pass, false);
  assert.equal(res.error, 'assistant_busy');
});

test('con reintentos, un 429 pasajero del proveedor no cuenta como error', async () => {
  const busy = () => Object.assign(new Error('assistant_busy'), { code: 'assistant_busy' });
  const res = await runCase(createFakeLlm([busy(), busy(), text('Solo turnos.')]), byId('rechaza_temas_ajenos'), { retries: 2, retryDelayMs: 0 });
  assert.equal(res.pass, true);
  assert.equal(res.usage.retries, 2);
});
