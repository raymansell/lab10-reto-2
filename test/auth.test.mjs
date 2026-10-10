import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startReplica, request } from './support.mjs';
import { message } from '../src/control.mjs';

test('solo el token de evaluación configurado autoriza las tres rutas protegidas', async () => {
  // Credenciales ficticias: los tokens reales nunca forman parte de los tests/fixtures.
  const evaluationToken = 'evaluation-only-test-token';
  const explorationToken = 'exploration-only-test-token';
  const server = await startReplica({ token: evaluationToken });
  const send = (testCase) => request(server.port, { token: evaluationToken, ...testCase });
  try {
    assert.equal((await send({ request: { m: message('ALTA;A') } })).status, 201);
    for (const endpoint of [
      { method: 'GET', path: '/health' },
      { path: '/__reset' },
      { path: '/msg', request: { m: message('ALTA;NoAutorizada') } },
    ]) {
      for (const auth of [{ token: explorationToken }, { token: 'incorrect-test-token' }, { auth: 'none' }]) {
        const response = await send({ ...endpoint, ...auth });
        assert.equal(response.status, 401);
        assert.deepEqual(response.body, { error: 'E001', mensaje: 'no autorizado' });
      }
    }
    assert.deepEqual((await send({ request: { m: message('CONSULTA;AC-0001') } })).body,
      { cuenta_id: 'AC-0001', saldo: 0 }, 'Un reset no autorizado no debe borrar cuentas');
    assert.deepEqual((await send({ request: { m: message('ALTA;B') } })).body,
      { cuentaId: 'AC-0002' }, 'Una alta no autorizada no debe consumir IDs');
    assert.deepEqual((await send({ method: 'GET', path: '/health' })).body, { ok: true });
    assert.deepEqual((await send({ path: '/__reset' })).body, { ok: true });
    assert.equal((await send({ request: { m: message('CONSULTA;AC-0001') } })).status, 404);
    assert.equal((await send({ path: '/inexistente', auth: 'none' })).status, 404);
  } finally { await server.close(); }
});

test('arranque carga .env opcional y el secreto de la plataforma tiene prioridad', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'replica-env-test-'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const args = pkg.scripts.start.split(' ').slice(1, -1);
  const env = { ...process.env };
  delete env.REPLICA_TOKEN;
  const check = (environment, expected) => {
    const source = `import assert from 'node:assert/strict'; assert.equal(process.env.REPLICA_TOKEN, ${JSON.stringify(expected)});`;
    const child = spawnSync(process.execPath, [...args, '--input-type=module', '-e', source],
      { cwd: directory, env: environment, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  };
  try {
    check({ ...env, REPLICA_TOKEN: 'platform-test-token' }, 'platform-test-token');
    await writeFile(join(directory, '.env'), 'REPLICA_TOKEN=file-test-token\n', { mode: 0o600 });
    check(env, 'file-test-token');
    check({ ...env, REPLICA_TOKEN: 'platform-test-token' }, 'platform-test-token');
  } finally { await rm(directory, { recursive: true }); }
});
