"""Repite control y estado con token exclusivo; sin --run solo verifica el log."""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from probe_control import Collector
from verify_exploration import exact, same_response

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / 'pruebas/aislamiento/08-sin-concurrencia.json'
PREFIX = '08-aislado'


def cases():
    control = json.loads((ROOT / 'pruebas/control/06-predicciones-corregidas.json').read_text())
    state = json.loads((ROOT / 'pruebas/planes/02-estado-entrada.json').read_text())
    transfer = json.loads((ROOT / 'pruebas/planes/03-confirmacion.json').read_text())
    groups = {'control': [dict(path='/__reset', hipotesis='Reset antes de validar control sin concurrencia')] + [
        dict(request={'m': c['message']}, hipotesis=c['hipotesis']) for c in control
    ] + [dict(path='/__reset', hipotesis='Restaurar estado después de validar control')]}
    for name, source, seq in [
        ('deposito', state, 'exploracion-02-estado-1'),
        ('precedencia', state, 'exploracion-02-precedencia-1'),
        ('transferencia', transfer, 'exploracion-03-reversa-transfer-1'),
    ]:
        groups[name] = [{k: v for k, v in c.items() if k != 'seq'} for c in source if c['seq'] == seq]
    return control, groups


def run(groups):
    token = sys.stdin.read().strip()
    if not token:
        raise SystemExit('Falta token por stdin')
    collector = Collector(token, PLAN)
    for repetition in (1, 2):
        for group, group_cases in groups.items():
            seq = f'{PREFIX}-{group}-{repetition}'
            for i, case in enumerate(group_cases, 1):
                collector.send(seq, case['hipotesis'], message=case.get('request', {}).get('m'),
                               reset=case.get('path') == '/__reset')
                if i % 30 == 0:
                    print(f'{seq}: {i}/{len(group_cases)} registrados', flush=True)
            print(f'{seq}: completa ({len(group_cases)} requests)', flush=True)


def verify(predictions, groups):
    log = [json.loads(line) for line in (ROOT / 'experimentos.jsonl').read_text().splitlines()]
    assert [r['id'] for r in log] == list(range(1, len(log) + 1))
    by_seq = {}
    for row in log:
        by_seq.setdefault(row['seq'], []).append(row)
    selected = [r for r in log if r['seq'].startswith(PREFIX + '-')]
    assert len(selected) == sum(len(c) for c in groups.values()) * 2
    assert all(r['infra'] is None for r in selected)
    evidence, fixtures, comparisons = [], [], []
    baselines = {'deposito': 'exploracion-02-estado-1', 'precedencia': 'exploracion-02-precedencia-1',
                 'transferencia': 'exploracion-03-reversa-transfer-1'}
    for group, group_cases in groups.items():
        pair = []
        for repetition in (1, 2):
            seq = f'{PREFIX}-{group}-{repetition}'
            rows = by_seq[seq]
            assert len(rows) == len(group_cases)
            account_counter = operation_counter = 0
            for case, row in zip(group_cases, rows):
                assert row['path'] == case.get('path', '/msg')
                assert exact(row['request'], case.get('request'))
                if row['path'] == '/__reset':
                    assert row['status'] == 200 and row['response'] == {'ok': True}
                    account_counter = operation_counter = 0
                body = row['response']
                if 'cuentaId' in body:
                    account_counter += 1
                    assert body['cuentaId'] == f'AC-{account_counter:04d}', f"ID inesperado en {row['id']}"
                if 'operacionId' in body:
                    operation_counter += 1
                    assert body['operacionId'] == f'OP-{operation_counter:04d}', f"Operación inesperada en {row['id']}"
                fixtures.append(dict(evidence_id=row['id'], seq=seq, case=case,
                                     status=row['status'], response=body, raw_response=row['raw_response']))
            if group == 'control':
                for prediction, row in zip(predictions, rows[1:-1]):
                    if prediction['kind'] == 'invalid':
                        assert row['status'] == 400 and row['response'] == {'error': 'E202', 'mensaje': 'control inválido'}
                    else:
                        # En aislamiento, todos los comandos conocidos de este corpus deben tener éxito,
                        # salvo ALTA con aridad extra y el comando con espacio inicial.
                        payload = prediction['payload']
                        command = payload.split(';')[0].upper()
                        expected_error = 'E302' if payload == 'ALTA;Ana;Maria' else None
                        if command not in ('ALTA', 'CONSULTA', 'DEPOSITO', 'TRANSFER', 'ANULA'):
                            expected_error = 'E301'
                        if expected_error:
                            assert row['status'] == 400 and row['response']['error'] == expected_error
                        else:
                            assert row['status'] == (201 if command == 'ALTA' else 200), row
                # Después de anular las dos transferencias, se recuperan ambos depósitos.
                for payload, amount in [('CONSULTA;AC-0001', 12345), ('CONSULTA;AC-0002', 75)]:
                    matches = [r for c, r in zip(predictions, rows[1:-1]) if c['payload'] == payload and c['kind'] == 'valid']
                    assert matches[-1]['response']['saldo'] == amount
            else:
                baseline = by_seq[baselines[group]]
                assert len(rows) == len(baseline)
                assert all(same_response(a, b) for a, b in zip(rows, baseline)), f'Cambio de estado: {seq}'
            evidence.append(dict(seq=seq, count=len(rows), first_id=rows[0]['id'], last_id=rows[-1]['id']))
            pair.append(rows)
        assert all(same_response(a, b) for a, b in zip(*pair)), f'Repetición distinta: {group}'
        comparisons.append(dict(group=group, exact_response_matches=len(pair[0]), total=len(pair[0])))
    summary = dict(new_requests=len(selected), total_logged=len(log),
                   first_id=selected[0]['id'], last_id=selected[-1]['id'],
                   started_at_bogota=datetime.fromisoformat(selected[0]['observed_at']).astimezone(ZoneInfo('America/Bogota')).isoformat(),
                   ended_at_bogota=datetime.fromisoformat(selected[-1]['observed_at']).astimezone(ZoneInfo('America/Bogota')).isoformat(),
                   control_checks=len(predictions)*2, control_failures=0,
                   comparisons=comparisons, sequences=evidence, infra_responses=0,
                   unexpected_account_or_operation_ids=0, state_matches_historical_baseline=True,
                   exclusive_token_confirmed_by_user=True)
    (ROOT / 'docs/evidencia-aislamiento.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
    (ROOT / 'pruebas/aislamiento/08-fixtures.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False)+'\n' for r in fixtures))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', action='store_true')
    args = parser.parse_args()
    predictions, groups = cases()
    if args.run:
        run(groups)
    verify(predictions, groups)
