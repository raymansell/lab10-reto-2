import { createReplica } from './http.mjs';

const rawPort = process.env.PORT ?? '3000';
if (!/^[0-9]+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
  throw new Error('PORT debe estar entre 1 y 65535');
}
const server = createReplica({ token: process.env.REPLICA_TOKEN });
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(Number(rawPort), process.env.HOST ?? '127.0.0.1', () => {
  const address = server.address();
  console.log(`Réplica disponible en http://${address.address}:${address.port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close());
}
