import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_ACCOUNT_ID } from '../../db/seed.js';

// spec 006 RF-10 / D-P8: el README no miente — sus scripts, variables y enlaces existen.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const scriptsOf = (rel) => new Set(Object.keys(JSON.parse(read(rel)).scripts));
const envVarsOf = (text) => [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]);

// Devuelve los problemas encontrados; vacío si el README es coherente.
export const checkReadme = ({ readme, scripts, envVars, exists }) => {
  const problems = [];

  // npm run X: el directorio sale del último `cd backend|frontend` del bloque de código o de la propia línea.
  let dir = null;
  let inFence = false;
  for (const line of readme.split('\n')) {
    if (line.trim().startsWith('```')) { inFence = !inFence; dir = null; continue; }
    const cd = line.match(/\bcd (?:\.\.\/)?(backend|frontend)\b/);
    if (cd) dir = cd[1];
    for (const m of line.matchAll(/npm run ([\w:.-]+)/g)) {
      const where = line.match(/\b(backend|frontend)\b/)?.[1] ?? dir;
      if (!where) problems.push(`npm run ${m[1]}: no se sabe en qué directorio (backend o frontend) se ejecuta`);
      else if (!scripts[where].has(m[1])) problems.push(`npm run ${m[1]} no existe en ${where}/package.json`);
    }
  }

  for (const name of envVars) {
    if (!new RegExp(`\\b${name}\\b`).test(readme)) problems.push(`la variable ${name} de .env.example no está en el README`);
  }

  for (const m of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^([a-z]+:|#)/i.test(target)) continue;
    if (!exists(target.split('#')[0])) problems.push(`el enlace ${target} apunta a algo que no existe`);
  }

  return problems;
};

const fakeScripts = { backend: new Set(['test', 'db:migrate']), frontend: new Set(['build']) };
const fake = (readme, extra = {}) => checkReadme({
  readme, scripts: fakeScripts, envVars: ['JWT_SECRET'], exists: (p) => p === 'docs/ok.md', ...extra,
});
const GOOD = 'JWT_SECRET\n```bash\ncd backend && npm run db:migrate\ncd ../frontend\nnpm run build\n```\n[ok](docs/ok.md#x) [web](https://example.com)';

test('detecta un script que no existe', () => {
  assert.deepEqual(fake(GOOD.replace('db:migrate', 'db:nope')), ['npm run db:nope no existe en backend/package.json']);
});

test('un script que existe solo en el otro workspace se detecta', () => {
  assert.equal(fake(GOOD.replace('npm run build', 'npm run db:migrate')).length, 1);
});

test('detecta una variable de .env.example sin documentar', () => {
  assert.deepEqual(fake(GOOD.replace('JWT_SECRET', 'otra')), ['la variable JWT_SECRET de .env.example no está en el README']);
});

test('detecta un enlace relativo roto', () => {
  assert.deepEqual(fake(GOOD.replace('docs/ok.md', 'docs/roto.md')), ['el enlace docs/roto.md#x apunta a algo que no existe']);
});

test('un README coherente no tiene problemas', () => {
  assert.deepEqual(fake(GOOD), []);
});

test('el README real no miente', () => {
  assert.ok(existsSync(join(ROOT, 'README.md')), 'falta README.md');
  const readme = read('README.md');
  const problems = checkReadme({
    readme,
    scripts: { backend: scriptsOf('backend/package.json'), frontend: scriptsOf('frontend/package.json') },
    envVars: [...envVarsOf(read('.env.example')), ...envVarsOf(read('backend/.env.example'))],
    exists: (p) => existsSync(join(ROOT, p)),
  });
  assert.deepEqual(problems, []);
  assert.ok(readme.includes(DEMO_ACCOUNT_ID), 'el README debe incluir el id fijo de la cuenta demo');
});

// spec 009 criterio 3: servicios, equipo y horarios ya tienen pantalla y el README deja de decir "solo por API".
test('el README real dice que servicios, equipo y horarios tienen pantalla', () => {
  const readme = read('README.md');
  for (const row of ['Editar servicios y precios', 'Gestionar trabajadores', 'Editar el horario semanal']) {
    const line = readme.split('\n').find(l => l.startsWith(`| ${row}`));
    assert.ok(line, `falta la fila "${row}" en la tabla de roles`);
    assert.ok(line.trimEnd().endsWith('| Pantalla |'), `"${row}" debe figurar como Pantalla: ${line}`);
  }
  assert.ok(!/activación de un trabajador invitado no tiene pantalla/i.test(readme), 'la activación ya tiene pantalla');
  assert.ok(!/administrar servicios, trabajadores, horarios/i.test(readme), 'el límite de "solo por API" ya no incluye servicios, trabajadores ni horarios');
  assert.ok(readme.includes('APP_URL'), 'APP_URL debe estar documentada');
  assert.ok(readme.includes('/activar'), 'el README debe explicar el enlace de activación');
});
