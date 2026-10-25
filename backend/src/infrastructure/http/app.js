import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createApp } from './createApp.js';
import { startCron } from '../integrations/cron.js';
import { createLlmClient } from '../integrations/llm/index.js';

// spec 008 RF-14: la configuración se valida antes de abrir el puerto. Si es inválida no se arranca y el mensaje
// nombra la variable (nunca imprime el secreto).
let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`[config] ${err.message}`);
  process.exit(1);
}

// spec 011 RNF-2: sin la clave del proveedor elegido el asistente queda deshabilitado y el resto funciona.
const llm = createLlmClient(config);
if (!llm) console.log('[assistant] deshabilitado: falta la clave del proveedor (/assistant/* responde 503)');

const app = createApp({ trustProxy: config.trustProxy, assistant: { llm } });

startCron();

app.listen(config.port, () => console.log(`listening on ${config.port}`));

export default app;
