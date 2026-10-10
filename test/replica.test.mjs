import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { control, message } from '../src/control.mjs';
import { createEngine } from '../src/state.mjs';
import { createReplica } from '../src/http.mjs';
import { request, startReplica } from './support.mjs';
import { runRegression, saveReport } from '../scripts/regression.mjs';

test('regresión HTTP completa contra evidencia no contaminada y ejemplos', async () => {
  const report = await runRegression();
  await saveReport(report);
  assert.equal(report.total, 1204, 'Un cambio del corpus requiere revisar su cobertura');
  assert.deepEqual(report.failures, []);
  assert.equal(report.matched, report.total);
});

test('control: predicciones observadas y precisión sobre números grandes', async () => {
  const cases = JSON.parse(await readFile(new URL('../pruebas/control/06-predicciones-corregidas.json', import.meta.url)));
  for (const entry of cases) {
    assert.equal(control(entry.payload), entry.predicted, entry.payload);
    assert.equal(message(entry.payload) === entry.message, entry.kind === 'valid');
  }
  const digits = '1234567890'.repeat(1000);
  assert.equal(control(digits), String(98n - (BigInt(digits) * 100n) % 97n));
});

test('reset elimina cuentas, operaciones, anulaciones y ambos contadores', () => {
  const engine = createEngine();
  const send = (payload) => engine.dispatch({ m: message(payload) });
  send('ALTA;Nueva');
  send('DEPOSITO;AC-0001;500');
  send('ANULA;OP-0001');
  engine.reset();
  assert.equal(send('CONSULTA;AC-0001').body.error, 'E401');
  assert.equal(send('ANULA;OP-0001').body.error, 'E402');
  assert.deepEqual(send('ALTA;Otra').body, { cuentaId: 'AC-0001' });
  assert.deepEqual(send('DEPOSITO;AC-0001;700').body, { status: 'recieved', operacionId: 'OP-0001' });
  assert.deepEqual(send('ANULA;OP-0001').body, { ok: true, anulada: 'OP-0001' });
});

test('requests concurrentes completan transiciones sin perder depósitos', async () => {
  const server = await startReplica();
  try {
    await request(server.port, { request: { m: message('ALTA;Concurrente') } });
    const responses = await Promise.all(Array.from({ length: 40 }, () =>
      request(server.port, { request: { m: message('DEPOSITO;AC-0001;7') } })));
    assert.ok(responses.every((r) => r.status === 200));
    assert.equal(new Set(responses.map((r) => r.body.operacionId)).size, 40);
    assert.equal((await request(server.port, { request: { m: message('CONSULTA;AC-0001') } })).body.saldo, 280);
  } finally { await server.close(); }
});

test('supuestos numéricos no producen mutaciones parciales ni IDs consumidos', () => {
  const engine = createEngine();
  const send = (payload) => engine.dispatch({ m: message(payload) });
  send('ALTA;A'); send('ALTA;B');
  for (const value of ['0', '-1', '1.5', 'NaN', '9007199254740992']) {
    assert.equal(send(`DEPOSITO;AC-0001;${value}`).body.error, 'E501');
  }
  assert.equal(send('DEPOSITO;AC-0001;250000').body.operacionId, 'OP-0001');
  assert.equal(send('TRANSFER;AC-0001;AC-0002;100001').body.error, 'E506');
  assert.equal(send('CONSULTA;AC-0001').body.saldo, 250000);
  assert.equal(send('TRANSFER;AC-0001;AC-0001;1').body.operacionId, 'OP-0002');
  assert.equal(send('CONSULTA;AC-0001').body.saldo, 250000);
  assert.equal(send('ANULA;OP-0002').body.ok, true);
  assert.equal(send('CONSULTA;AC-0001').body.saldo, 250000);
});

test('límite local provisional y precedencia HTTP no modifican estado', async () => {
  const server = await startReplica({ maxBodyBytes: 64 });
  try {
    assert.equal((await request(server.port, { raw: 'x'.repeat(65) })).status, 413);
    assert.equal((await request(server.port, { raw: 'x'.repeat(65), auth: 'none' })).status, 401);
    assert.equal((await request(server.port, { path: '/no-existe', raw: '{', auth: 'none' })).status, 404);
    assert.equal((await request(server.port, { raw: '{' })).body.error, 'E100');
    assert.equal((await request(server.port, { request: { m: message('ALTA;Después') } })).body.cuentaId, 'AC-0001');
  } finally { await server.close(); }
});

test('token obligatorio y cada instancia conserva su propio estado', () => {
  assert.throws(() => createReplica(), /REPLICA_TOKEN/);
  const missing = spawnSync(process.execPath, ['src/main.mjs'], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, REPLICA_TOKEN: '' }, encoding: 'utf8',
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /REPLICA_TOKEN/);
  const first = createEngine();
  first.dispatch({ m: message('ALTA;A') });
  assert.equal(createEngine().dispatch({ m: message('CONSULTA;AC-0001') }).body.error, 'E401');
});
