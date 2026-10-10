"""Verifica evidencia local y exporta fixtures; no llama al servicio original."""
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]


def exact(a, b):
    """Igualdad JSON sin confundir booleanos con números ni ordenar arrays."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(exact(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
    return a == b


def same_response(a, b):
    return a['status'] == b['status'] and exact(a['response'], b['response'])


def main():
    rows = [json.loads(line) for line in (ROOT / 'experimentos.jsonl').read_text().splitlines()]
    assert [r['id'] for r in rows] == list(range(1, len(rows) + 1)), 'IDs no consecutivos'
    by_seq = {}
    for row in rows:
        by_seq.setdefault(row['seq'], []).append(row)
    fixtures = []
    for path in sorted((ROOT / 'pruebas/planes').glob('*.json')):
        plan = json.loads(path.read_text())
        offsets = {}
        for case in plan:
            seq = case['seq']
            offset = offsets.get(seq, 0)
            observed = by_seq[seq][offset]
            offsets[seq] = offset + 1
            assert observed['method'] == case.get('method', 'POST')
            assert observed['path'] == case.get('path', '/msg')
            assert observed['auth'] == case.get('auth', 'valid')
            assert exact(observed['request'], case.get('request', case.get('raw')))
            assert observed['infra'] is None, f"Infraestructura en {observed['id']}"
            fixtures.append(dict(evidence_id=observed['id'], case=case,
                                 status=observed['status'], response=observed['response'],
                                 raw_response=observed['raw_response']))
        for seq, count in offsets.items():
            assert len(by_seq[seq]) == count, f'Secuencia incompleta o repetida: {seq}'

    examples = [json.loads(line) for line in (ROOT / 'pruebas/ejemplos.jsonl').read_text().splitlines()]
    replay = by_seq['exploracion-01-replay'][1:-1]
    assert len(replay) == len(examples) == 20
    assert all(exact(a['request'], b['request']) for a, b in zip(replay, examples))
    assert all(same_response(a, b) for a, b in zip(replay, examples))
    repeated = []
    pairs = [
        ('exploracion-02-estado-1', 'exploracion-02-estado-2'),
        ('exploracion-02-precedencia-1', 'exploracion-02-precedencia-2'),
        ('exploracion-02-entrada', 'exploracion-03-entrada-repetida'),
        ('exploracion-03-reversa-transfer-1', 'exploracion-03-reversa-transfer-2'),
    ]
    for left, right in pairs:
        a, b = by_seq[left], by_seq[right]
        assert len(a) == len(b)
        assert all(all(exact(x[k], y[k]) for k in ['method', 'path', 'auth', 'request'])
                   for x, y in zip(a, b)), f'Entradas diferentes: {left} / {right}'
        assert all(same_response(x, y) for x, y in zip(a, b)), f'Diferencia: {left} / {right}'
        repeated.append(dict(first=left, second=right, matched=len(a), total=len(a)))
    control = by_seq['exploracion-03-control-formato']
    assert len(control) == 18
    # ALTA válido crea una cuenta diferente en cada repetición de la misma secuencia.
    assert all(same_response(control[1 + i], control[9 + i]) for i in range(8) if i != 1)
    assert control[2]['status'] == control[10]['status'] == 201
    assert control[2]['response'] == {'cuentaId': 'AC-0001'}
    assert control[10]['response'] == {'cuentaId': 'AC-0002'}
    local_time = lambda value: datetime.fromisoformat(value).astimezone(ZoneInfo('America/Bogota')).isoformat()
    summary = dict(new_requests=len(fixtures), total_logged=len(rows),
                   first_evidence_id=fixtures[0]['evidence_id'], last_evidence_id=fixtures[-1]['evidence_id'],
                   started_at_bogota=local_time(rows[fixtures[0]['evidence_id'] - 1]['observed_at']),
                   ended_at_bogota=local_time(rows[fixtures[-1]['evidence_id'] - 1]['observed_at']),
                   replay_matched=20, replay_total=20, repeated_sequences=repeated,
                   repeated_control_errors=7, control_success_account_ids=['AC-0001', 'AC-0002'],
                   infra_responses=0, replacement_tested=False)
    (ROOT / 'pruebas/exploracion-observada.jsonl').write_text(
        ''.join(json.dumps(f, ensure_ascii=False) + '\n' for f in fixtures))
    (ROOT / 'docs/evidencia-exploracion.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
