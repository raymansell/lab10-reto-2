import { spawnSync } from 'node:child_process';

const token = process.env.REPLICA_TOKEN;
if (!token || /[\r\n]/.test(token)) throw new Error('Configura REPLICA_TOKEN en el entorno o en .env');
const child = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'put', 'REPLICA_TOKEN'], {
  input: token + '\n', stdio: ['pipe', 'inherit', 'inherit'],
});
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
