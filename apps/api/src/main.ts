// Ponto de entrada da API: sobe o servidor HTTP com o relogio do sistema.
import { createApp } from './app.js';
import { systemClock } from './platform/clock.js';

const port = Number(process.env['PORT'] ?? '3000');
const app = await createApp({ clock: systemClock });
await app.listen({ port, host: '0.0.0.0' });
