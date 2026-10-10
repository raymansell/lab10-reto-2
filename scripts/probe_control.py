"""Recolector secuencial de hipótesis de control. Token por stdin, sin reintentos."""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = 'https://caja-negra-production-c64f.up.railway.app'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Collector:
    def __init__(self, token, plan_path):
        self.token = token
        self.plan_path = plan_path
        if plan_path.exists():
            raise ValueError('El plan ya existe; usa otro nombre para no sobrescribir evidencia')
        self.cases = []
        self.log = ROOT / 'experimentos.jsonl'
        self.idx = len(self.log.read_text().splitlines())
        self.opener = urllib.request.build_opener(NoRedirect)

    def send(self, seq, hypothesis, message=None, reset=False):
        case = dict(seq=seq, hipotesis=hypothesis, path='/__reset' if reset else '/msg')
        if not reset:
            case['request'] = {'m': message}
        self.cases.append(case)
        self.plan_path.parent.mkdir(parents=True, exist_ok=True)
        self.plan_path.write_text(json.dumps(self.cases, ensure_ascii=False, indent=2) + '\n')
        data = None if reset else json.dumps(case['request'], ensure_ascii=False).encode()
        req = urllib.request.Request(ORIGINAL + case['path'], data=data, method='POST',
                                     headers={'Authorization': 'Bearer ' + self.token,
                                              'Content-Type': 'application/json'})
        start = time.monotonic()
        try:
            response = self.opener.open(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        except (urllib.error.URLError, TimeoutError) as error:
            # Puede haber alcanzado el servidor; detenerse sin reintentar ni inventar una respuesta.
            failure = dict(case=case, observed_at=datetime.now(timezone.utc).isoformat(),
                           transport_error=type(error).__name__, response_received=False)
            self.plan_path.with_suffix('.transport-error.json').write_text(json.dumps(failure, indent=2)+'\n')
            raise SystemExit('Fallo de transporte: plan preservado; no se reintenta automáticamente')
        raw = response.read().decode('utf-8')
        try:
            body = json.loads(raw)
        except ValueError:
            body = raw
        self.idx += 1
        row = dict(id=self.idx, seq=seq, x_req=response.headers.get('X-Req'),
                   hipotesis=hypothesis, request=case.get('request'), status=response.status,
                   response=body, method='POST', path=case['path'], auth='valid',
                   raw_response=raw, content_type=response.headers.get('Content-Type'),
                   infra=response.headers.get('X-Frontier-Infra'),
                   latency_ms=round((time.monotonic()-start)*1000),
                   observed_at=datetime.now(timezone.utc).isoformat())
        with self.log.open('a') as stream:
            stream.write(json.dumps(row, ensure_ascii=False)+'\n')
        time.sleep(.25)
        if row['infra'] or row['status'] in (401, 429) or row['status'] >= 500:
            raise SystemExit(f"Sonda {self.idx}: infraestructura/auth/error de servidor; detener exploración")
        return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['hunt', 'verify'])
    parser.add_argument('input', type=Path)
    parser.add_argument('plan', type=Path)
    args = parser.parse_args()
    token = sys.stdin.read().strip()
    if not token:
        raise SystemExit('Falta token por stdin')
    collector = Collector(token, args.plan)
    cases = json.loads(args.input.read_text())
    found = []
    seq = args.plan.stem
    collector.send(seq, 'Reset previo a hipótesis de fórmula de control', reset=True)
    for case in cases:
        if args.mode == 'hunt':
            payload = case['payload']
            for control in range(100):
                row = collector.send(seq, f'Encontrar control canónico 0..99 para {payload!r}; detener al superar integridad',
                                     f'{payload};{control}')
                if row['response'].get('error') not in ('E201', 'E202'):
                    if row['response'].get('error') in ('E102', 'E103', 'E104'):
                        raise SystemExit(f'Error anterior al control: {row}')
                    found.append(dict(payload=payload, control=control, evidence_id=row['id'], response=row['response']))
                    print(json.dumps(found[-1], ensure_ascii=False), flush=True)
                    break
            else:
                print(json.dumps(dict(payload=payload, found=False)), flush=True)
        else:
            row = collector.send(seq, case['hipotesis'], case['message'])
            print(json.dumps({k: row[k] for k in ['id', 'request', 'status', 'response']}, ensure_ascii=False), flush=True)
    collector.send(seq, 'Restaurar estado tras hipótesis de control', reset=True)
    if args.mode == 'hunt':
        args.plan.with_suffix('.found.json').write_text(json.dumps(found, ensure_ascii=False, indent=2)+'\n')


if __name__ == '__main__':
    main()
