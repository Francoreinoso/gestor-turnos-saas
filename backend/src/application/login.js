import bcrypt from 'bcrypt';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 008 D7: hash válido con el mismo costo (10) que los reales de `routes/auth.js` y `activateStaffAccount`.
// Se calcula una vez al cargar el módulo: un hash inventado, o de otro costo, no igualaría los tiempos.
export const DUMMY_HASH = bcrypt.hashSync('contrasena-ficticia-para-igualar-tiempos', 10);

// spec 008 RF-12 — inicia sesión. Siempre ejecuta UNA comparación bcrypt completa: contra el hash del usuario si es
// utilizable (existe, está `activo` y tiene contraseña) y contra uno ficticio si no. Así un email inexistente, un
// usuario `pendiente` o `inactivo` y una clave incorrecta tardan lo mismo y responden el mismo 401.
// `compare` y `dummyHash` son inyectables para probar las ramas sin medir milisegundos (D-P4).
export const login = async (db, { email, password }, repos, { compare = bcrypt.compare, dummyHash = DUMMY_HASH } = {}) => {
  const user = await repos.users.findByEmail(db, email);
  const usable = Boolean(user && user.status === 'activo' && user.password_hash);

  const valid = await compare(password, usable ? user.password_hash : dummyHash);
  if (!usable || !valid) throw httpErr(401, 'invalid_credentials'); // spec 002: no filtra pendiente/inactivo

  return user;
};
