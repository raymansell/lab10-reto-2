import http from 'node:http';
import { once } from 'node:events';
import { createReplica } from '../src/http.mjs';

export const TEST_TOKEN = 'local-regression-token';

export async function startReplica(options = {}) {
  const server = createReplica({ token: TEST_TOKEN, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  return {
    port,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    }),
  };
}

// Solo loopback. No recibe URLs ni tokens del original.
export function request(port, testCase = {}) {
  let data;
  if (Object.hasOwn(testCase, 'raw')) data = Buffer.from(testCase.raw);
  else if (Object.hasOwn(testCase, 'request')) data = Buffer.from(JSON.stringify(testCase.request));
  const headers = { ...testCase.headers };
  if (testCase.auth !== 'none') headers.Authorization = `Bearer ${testCase.auth === 'invalid' ? 'invalid' : (testCase.token ?? TEST_TOKEN)}`;
  if (data !== undefined) {
    headers['Content-Type'] = testCase.content_type ?? 'application/json';
    headers['Content-Length'] = data.length;
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: testCase.path ?? '/msg',
      method: testCase.method ?? 'POST', headers, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body;
        let json = true;
        try { body = JSON.parse(raw); } catch { body = raw; json = false; }
        resolve({ status: res.statusCode, body, raw, json, headers: res.headers });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request local superó 5 segundos')));
    req.on('error', reject);
    req.end(data);
  });
}
