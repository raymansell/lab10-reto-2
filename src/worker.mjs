import { DurableObject } from 'cloudflare:workers';
import { createEngine } from './state.mjs';
import { error, result } from './responses.mjs';
import { MAX_BODY_BYTES } from './limits.mjs';

function send({ status, body }, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function discardBody(request) {
  const reader = request.body?.getReader();
  if (reader) while (!(await reader.read()).done) { /* consumir sin retener */ }
}

async function ignoredBodyResponse(request, response) {
  await discardBody(request);
  return send(response);
}

async function parseBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return { failure: error('E100') };
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { failure: result(413, { error: 'E100', mensaje: 'json inválido' }) };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { body: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { return { failure: error('E100') }; }
}

export class ReplicaState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS replica (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, requests INTEGER NOT NULL)');
  }

  async fetch(request) {
    const reset = new URL(request.url).pathname === '/__reset';
    if (reset) await discardBody(request);
    const parsed = reset ? null : await parseBody(request);
    // La transición y su persistencia se confirman juntas, antes de responder.
    return this.ctx.storage.transactionSync(() => {
      const rows = [...this.ctx.storage.sql.exec('SELECT state, requests FROM replica WHERE id = 1')];
      const saved = rows[0];
      const engine = createEngine(saved ? JSON.parse(saved.state) : undefined);
      const requests = (saved?.requests ?? 0) + (reset ? 0 : 1);
      const response = reset ? engine.reset() : parsed.failure ?? engine.dispatch(parsed.body);
      this.ctx.storage.sql.exec('INSERT INTO replica (id, state, requests) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, requests = excluded.requests', JSON.stringify(engine.snapshot()), requests);
      return send(response, reset ? {} : { 'X-Req': String(requests) });
    });
  }
}

export default {
  async fetch(request, env) {
    const route = `${request.method} ${new URL(request.url).pathname}`;
    if (!['POST /msg', 'POST /__reset', 'GET /health'].includes(route)) return ignoredBodyResponse(request, error('E404'));
    if (typeof env.REPLICA_TOKEN !== 'string' || !env.REPLICA_TOKEN.length) {
      return ignoredBodyResponse(request, result(503, { error: 'configuración incompleta' }));
    }
    if (request.headers.get('Authorization') !== `Bearer ${env.REPLICA_TOKEN}`) return ignoredBodyResponse(request, error('E001'));
    if (route === 'GET /health') return ignoredBodyResponse(request, result(200, { ok: true }));
    return env.REPLICA_STATE.getByName('evaluation').fetch(request);
  },
};
