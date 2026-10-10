import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { buildSync } from 'esbuild';
import { loadCorpus } from './corpus.mjs';
import { message } from '../src/control.mjs';

const token = 'cloudflare-local-test';
const script = buildSync({ entryPoints: ['src/worker.mjs'], bundle: true, write: false,
  format: 'esm', external: ['cloudflare:workers'] }).outputFiles[0].text;
const options = (directory) => convertV4MiniflareOptions({
  name: 'caja-negra-replica', modules: true, script,
  compatibilityDate: '2026-10-10',
  bindings: { REPLICA_TOKEN: token },
  durableObjects: { REPLICA_STATE: { className: 'ReplicaState', useSQLite: true } },
  resourcePersistencePath: directory || undefined,
});

async function request(mf, input = {}) {
  const headers = { ...input.headers };
  if (input.auth !== 'none') headers.Authorization = `Bearer ${input.auth === 'invalid' ? 'invalid' : token}`;
  const method = input.method ?? 'POST';
  let body;
  // Fetch prohíbe cuerpos GET/HEAD; estas rutas nunca leen el cuerpo.
  if (!['GET', 'HEAD'].includes(method)) {
    if (Object.hasOwn(input, 'raw')) body = input.raw;
    else if (Object.hasOwn(input, 'request')) body = JSON.stringify(input.request);
  }
  if (body !== undefined) headers['Content-Type'] = input.content_type ?? 'application/json';
  const response = await mf.dispatchFetch(`https://replica.test${input.path ?? '/msg'}`, { method, headers, body });
  return { status: response.status, body: await response.json() };
}

test('Cloudflare reproduce las 1204 respuestas confirmadas', async () => {
  const mf = new Miniflare(options(false));
  try {
    const { groups } = await loadCorpus();
    let matched = 0;
    for (const [name, rows] of groups) {
      assert.deepEqual(await request(mf, { path: '/__reset' }), { status: 200, body: { ok: true } });
      for (const row of rows) {
        let actual;
        try { actual = await request(mf, row.case); }
        catch (cause) { throw new Error(`${name}: ${row.evidenceId ?? row.exampleId} ${JSON.stringify(row.case)}`, { cause }); }
        assert.deepEqual(actual, { status: row.status, body: row.response }, `${name}: ${row.evidenceId ?? row.exampleId}`);
        matched++;
      }
    }
    assert.equal(matched, 1204);
  } finally { await mf.dispose(); }
});

test('Cloudflare conserva cuentas, anulaciones e IDs tras reiniciar y serializa depósitos concurrentes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'replica-cloudflare-'));
  let mf = new Miniflare(options(directory));
  const command = (payload) => request(mf, { request: { m: message(payload) } });
  try {
    await command('ALTA;persistente');
    const deposits = await Promise.all(Array.from({ length: 40 }, () => command('DEPOSITO;AC-0001;7')));
    assert.equal(new Set(deposits.map((r) => r.body.operacionId)).size, 40);
    await mf.dispose();
    mf = new Miniflare(options(directory));
    assert.deepEqual((await command('CONSULTA;AC-0001')).body, { cuenta_id: 'AC-0001', saldo: 280 });
    assert.equal((await command('ALTA;segunda')).body.cuentaId, 'AC-0002');
    assert.equal((await command('DEPOSITO;AC-0001;1')).body.operacionId, 'OP-0041');
    assert.equal((await command('ANULA;OP-0001')).body.ok, true);
    await mf.dispose();
    mf = new Miniflare(options(directory));
    assert.deepEqual((await command('ANULA;OP-0001')).body, { ok: false, motivo: 'ya anulada' });
    await request(mf, { path: '/__reset' });
    assert.equal((await command('ALTA;nueva')).body.cuentaId, 'AC-0001');
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});
