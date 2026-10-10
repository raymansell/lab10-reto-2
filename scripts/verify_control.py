"""Contrasta predicciones escritas antes de las sondas; no utiliza la red."""
import argparse
import json
from pathlib import Path

from control import control

ROOT = Path(__file__).resolve().parents[1]


def verify(predictions_path, seq):
    predictions = json.loads(predictions_path.read_text())
    log = [json.loads(line) for line in (ROOT / 'experimentos.jsonl').read_text().splitlines()]
    rows = [r for r in log if r['seq'] == seq]
    assert len(rows) == len(predictions) + 2, 'Secuencia incompleta'
    assert rows[0]['path'] == rows[-1]['path'] == '/__reset'
    assert rows[0]['response'] == rows[-1]['response'] == {'ok': True}
    accepted, rejected, failures, fixtures = [], [], [], []
    for case, row in zip(predictions, rows[1:-1]):
        assert row['request'] == {'m': case['message']}
        assert row['infra'] is None
        # Mantener reproducible la hipótesis histórica refutada de upper antes del filtro.
        version = case.get('formula_version', 'upper-first-v1')
        assert version in ('upper-first-v1', 'ascii-first-v2')
        candidate = control(case['payload'].upper()) if version == 'upper-first-v1' else control(case['payload'])
        assert case['predicted'] == candidate, 'La predicción cambió después del experimento'
        error = row['response'].get('error')
        if case['kind'] == 'invalid':
            passed = row['status'] == 400 and row['response'] == {'error': 'E202', 'mensaje': 'control inválido'}
            target = rejected
        else:
            # Solo éxitos o errores inequívocamente posteriores al control constituyen evidencia.
            passed = row['status'] in (200, 201) or error in (
                'E301', 'E302', 'E401', 'E402', 'E506', 'E507')
            target = accepted
        target.append(row['id'])
        if not passed:
            failures.append(dict(id=row['id'], message=case['message'], kind=case['kind'], response=row['response']))
        fixtures.append(dict(evidence_id=row['id'], case=case, status=row['status'], response=row['response']))
    result = dict(seq=seq, predicted_valid=len(accepted), predicted_invalid=len(rejected),
                  failures=failures, valid_evidence=accepted, invalid_evidence=rejected,
                  first_id=rows[0]['id'], last_id=rows[-1]['id'])
    output = ROOT / 'pruebas/control' / (seq + '.verification.json')
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ('valid_evidence', 'invalid_evidence')}, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)
    output.with_suffix('.fixtures.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False)+'\n' for r in fixtures))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('predictions', type=Path)
    parser.add_argument('seq')
    args = parser.parse_args()
    verify(args.predictions, args.seq)
