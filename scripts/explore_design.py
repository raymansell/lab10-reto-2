"""Sondas propias del diseño. Token por stdin; nunca se guarda en el log."""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
token = sys.stdin.read().strip()
plan = json.loads(Path(sys.argv[1]).read_text())
log = root / 'experimentos.jsonl'
idx = len(log.read_text().splitlines()) if log.exists() else 0
for case in plan:
    method, path = case.get('method', 'POST'), case.get('path', '/msg')
    auth = case.get('auth', 'valid')
    headers = {}
    if auth != 'none': headers['Authorization'] = 'Bearer ' + (token if auth == 'valid' else 'invalid-design-probe')
    if 'raw' in case:
        data = case['raw'].encode()
    elif 'request' in case:
        data = json.dumps(case['request'], ensure_ascii=False).encode()
    else: data = None
    if data is not None: headers['Content-Type'] = case.get('content_type', 'application/json')
    req = urllib.request.Request('https://caja-negra-production-c64f.up.railway.app'+path, data=data, headers=headers, method=method)
    start = time.monotonic()
    try:
        response = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read().decode('utf-8')
    try: body = json.loads(raw)
    except ValueError: body = raw
    idx += 1
    row = dict(id=idx, seq=case['seq'], x_req=response.headers.get('X-Req'), hipotesis=case['hipotesis'], request=case.get('request',case.get('raw')), status=response.status, response=body, method=method, path=path, auth=auth, raw_response=raw, content_type=response.headers.get('Content-Type'), infra=response.headers.get('X-Frontier-Infra'), latency_ms=round((time.monotonic()-start)*1000), observed_at=datetime.now(timezone.utc).isoformat())
    with log.open('a') as f: f.write(json.dumps(row,ensure_ascii=False)+'\n')
    print(json.dumps({k:row[k] for k in ['id','path','request','status','response','infra']},ensure_ascii=False),flush=True)
    time.sleep(.2)
