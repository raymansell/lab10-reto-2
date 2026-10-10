import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const jsonl = async (path) => (await readFile(new URL(path, root), 'utf8')).trim().split('\n').map(JSON.parse);
const plans = [
  'pruebas/planes/01-replay.json', 'pruebas/planes/02-estado-entrada.json', 'pruebas/planes/03-confirmacion.json',
  'pruebas/control/04-busqueda.json', 'pruebas/control/05-validacion.json',
  'pruebas/aislamiento/08-sin-concurrencia.json',
];

export async function loadCorpus() {
  const log = await jsonl('experimentos.jsonl');
  const groups = new Map();
  const cases = new Map();
  for (const path of plans) {
    for (const entry of JSON.parse(await readFile(new URL(path, root), 'utf8'))) {
      if (!cases.has(entry.seq)) cases.set(entry.seq, []);
      cases.get(entry.seq).push(entry);
    }
  }
  // Evidencia de estado contaminada por el uso compartido del token: excluir explícitamente.
  const excluded = new Set(['06-validacion-corregida', '07-repeticion']);
  const offsets = new Map();
  for (const row of log) {
    if (excluded.has(row.seq)) continue;
    if (row.infra) throw new Error(`Infraestructura en evidencia ${row.id}`);
    let testCase;
    if (row.id <= 76) {
      testCase = { path: row.path, method: row.method, auth: row.auth };
      if (row.id === 74) testCase.raw = row.request; // JSON mal formado histórico.
      else if (row.request !== null) testCase.request = row.request;
    } else {
      const offset = offsets.get(row.seq) ?? 0;
      testCase = cases.get(row.seq)?.[offset];
      offsets.set(row.seq, offset + 1);
      if (!testCase) throw new Error(`Falta plan para evidencia ${row.id}: ${row.seq}`);
    }
    assert.equal(testCase.path ?? '/msg', row.path, `Ruta de evidencia ${row.id}`);
    assert.equal(testCase.method ?? 'POST', row.method, `Método de evidencia ${row.id}`);
    assert.equal(testCase.auth ?? 'valid', row.auth, `Auth de evidencia ${row.id}`);
    const originalInput = Object.hasOwn(testCase, 'raw') ? testCase.raw
      : Object.hasOwn(testCase, 'request') ? testCase.request : null;
    assert.deepEqual(originalInput, row.request, `Solicitud de evidencia ${row.id}`);
    if (!groups.has(row.seq)) groups.set(row.seq, []);
    groups.get(row.seq).push({ case: testCase, evidenceId: row.id,
      status: row.status, response: row.response, raw: row.raw_response });
  }
  for (const [seq, plan] of cases) {
    if (offsets.get(seq) !== plan.length) throw new Error(`Plan incompleto: ${seq}`);
  }
  groups.set('ejemplos-entregados', (await jsonl('pruebas/ejemplos.jsonl')).map((row) => ({
    case: { request: row.request }, exampleId: row.id, status: row.status, response: row.response,
    raw: JSON.stringify(row.response),
  })));
  return { groups, excludedSequences: [...excluded], excludedRequests: log.filter((r) => excluded.has(r.seq)).length };
}
