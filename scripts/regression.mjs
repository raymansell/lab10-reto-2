import { isDeepStrictEqual } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { startReplica, request } from '../test/support.mjs';
import { loadCorpus } from '../test/corpus.mjs';

export async function runRegression() {
  const { groups, excludedSequences, excludedRequests } = await loadCorpus();
  const server = await startReplica();
  const sequences = [];
  const failures = [];
  const timings = [];
  let total = 0;
  try {
    for (const [name, rows] of groups) {
      const reset = await request(server.port, { path: '/__reset' });
      if (reset.status !== 200 || !isDeepStrictEqual(reset.body, { ok: true })) throw new Error('Reset local falló');
      let matched = 0;
      for (const row of rows) {
        const start = performance.now();
        const actual = await request(server.port, row.case);
        timings.push(performance.now() - start);
        total++;
        const sameBody = actual.json ? isDeepStrictEqual(actual.body, row.response) : actual.raw === row.raw;
        if (actual.status === row.status && sameBody) matched++;
        else failures.push({ sequence: name, evidenceId: row.evidenceId, exampleId: row.exampleId,
          case: row.case, expected: { status: row.status, body: row.response },
          actual: { status: actual.status, body: actual.body } });
      }
      sequences.push({ name, matched, total: rows.length });
    }
  } finally { await server.close(); }
  timings.sort((a, b) => a - b);
  return {
    generatedAt: new Date().toISOString(), node: process.version,
    total, matched: total - failures.length,
    sequencesMatched: sequences.filter((s) => s.matched === s.total).length,
    sequencesTotal: sequences.length,
    localLatencyMs: { p95: timings[Math.ceil(timings.length * 0.95) - 1], max: timings.at(-1) },
    excludedSequences, excludedRequests, originalRequestsSent: 0, sequences, failures,
  };
}

export async function saveReport(report) {
  const directory = new URL('../output/verification/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('replica-regression.json', directory), JSON.stringify(report, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runRegression();
  await saveReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
