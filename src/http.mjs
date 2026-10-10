import { createServer } from 'node:http';
import { createEngine } from './state.mjs';
import { error, result } from './responses.mjs';

// S-05: límite local provisional, no medido en el original.
export const MAX_BODY_BYTES = 1_048_576;

export function createReplica({ token, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  if (typeof token !== 'string' || !token.length || /[\r\n]/.test(token)) {
    throw new Error('REPLICA_TOKEN debe ser un token no vacío y sin saltos de línea');
  }
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error('Límite de cuerpo inválido');
  const engine = createEngine();
  let requestCount = 0;
  return createServer((req, res) => {
    const send = ({ status, body }) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    // No usar URL.pathname: normalizaría segmentos . y .. sin evidencia.
    const path = (req.url ?? '').split('?')[0];
    const route = `${req.method} ${path}`;
    const known = route === 'POST /msg' || route === 'POST /__reset' || route === 'GET /health';
    req.on('error', () => res.destroy());
    if (!known) { req.resume(); send(error('E404')); return; }
    if (req.headers.authorization !== `Bearer ${token}`) {
      req.resume(); send(error('E001')); return;
    }
    if (route === 'GET /health') { req.resume(); send(result(200, { ok: true })); return; }
    if (route === 'POST /__reset') { req.resume(); send(engine.reset()); return; }
    res.setHeader('X-Req', String(++requestCount));
    const chunks = [];
    let size = 0;
    let oversized = false;
    req.on('data', (chunk) => {
      if (oversized) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        oversized = true;
        chunks.length = 0;
        send(result(413, { error: 'E100', mensaje: 'json inválido' }));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { send(error('E100')); return; }
      send(engine.dispatch(body));
    });
  });
}
