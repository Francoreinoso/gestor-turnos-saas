import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createApp } from './createApp.js';
import { startCron } from '../integrations/cron.js';

// spec 008 RF-14: la configuración se valida antes de abrir el puerto. Si es inválida no se arranca y el mensaje
// nombra la variable (nunca imprime el secreto).
let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`[config] ${err.message}`);
  process.exit(1);
}

const app = createApp({ trustProxy: config.trustProxy });

startCron();

app.listen(config.port, () => console.log(`listening on ${config.port}`));

export default app;
