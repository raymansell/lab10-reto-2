import https from 'node:https';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { loadCorpus } from '../test/corpus.mjs';

const endpoint = new URL(process.argv[2]);
if (endpoint.protocol !== 'https:' || !/^caja-negra-replica\.[a-z0-9-]+\.workers\.dev$/.test(endpoint.hostname)
  || endpoint.username || endpoint.password || endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
  throw new Error('Usa la URL raíz workers.dev de caja-negra-replica publicada por Wrangler');
}
const token = process.env.REPLICA_TOKEN;
if (!token || /[\r\n]/.test(token)) throw new Error('Configura REPLICA_TOKEN');
const agent = new https.Agent({ keepAlive: true });
function request(input = {}) {
  const headers = { ...input.headers };
  if (input.auth !== 'none') headers.Authorization = `Bearer ${input.auth === 'invalid' ? 'invalid' : token}`;
  let body;
  if (Object.hasOwn(input, 'raw')) body = Buffer.from(input.raw);
  else if (Object.hasOwn(input, 'request')) body = Buffer.from(JSON.stringify(input.request));
  if (body !== undefined) {
    headers['Content-Length'] = body.length;
    headers['Content-Type'] = input.content_type ?? 'application/json';
  }
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: endpoint.hostname, path: input.path ?? '/msg',
      method: input.method ?? 'POST', headers, agent, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body;
        try { body = JSON.parse(raw); } catch { body = raw; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Solicitud pública superó 5 segundos')));
    req.on('error', reject);
    req.end(body);
  });
}

const timings = [];
const failures = [];
let total = 0;
try {
  assert.deepEqual(await request({ path: '/health', method: 'GET' }), { status: 200, body: { ok: true } });
  for (const path of ['/health', '/msg', '/__reset']) {
    for (const auth of ['none', 'invalid']) {
      assert.deepEqual(await request({ path, method: path === '/health' ? 'GET' : 'POST', auth }),
        { status: 401, body: { error: 'E001', mensaje: 'no autorizado' } });
    }
  }
  const { groups } = await loadCorpus();
  for (const [sequence, rows] of groups) {
    assert.deepEqual(await request({ path: '/__reset' }), { status: 200, body: { ok: true } });
    for (const row of rows) {
      const start = performance.now();
      const actual = await request(row.case);
      timings.push(performance.now() - start);
      total++;
      if (!isDeepStrictEqual(actual, { status: row.status, body: row.response })) {
        failures.push({ sequence, evidenceId: row.evidenceId, exampleId: row.exampleId,
          expected: { status: row.status, body: row.response }, actual });
      }
    }
    console.log(`${sequence}: ${rows.length} respuestas comprobadas`);
  }
} finally {
  try { assert.equal((await request({ path: '/__reset' })).status, 200); }
  finally { agent.destroy(); }
}
timings.sort((a, b) => a - b);
const report = { generatedAt: new Date().toISOString(), url: endpoint.origin, total,
  matched: total - failures.length, failures,
  latencyMs: { p95: timings[Math.ceil(timings.length * 0.95) - 1], max: timings.at(-1) },
  authenticationChecks: 7, originalRequestsSent: 0, finalState: 'reset' };
await writeFile(new URL('../output/verification/cloudflare-regression.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
