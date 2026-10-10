# Revalidación con token exclusivo

10 de octubre de 2026, 13:26:59–13:30:05, America/Bogota. El usuario confirmó que ninguna otra sesión utilizaba el token al comenzar esta ronda.

Se enviaron **334 requests**, IDs **1099–1432** de `experimentos.jsonl`. Se repitieron cuatro grupos de pruebas, cada uno desde reset. Las respuestas completas —status y cuerpo JSON, incluidos saldos e IDs— coinciden en **167/167 pares** entre ambas ejecuciones. Los conteos incluyen resets. No hubo respuestas marcadas como infraestructura y el último request restableció el estado.

| Grupo | Primera ejecución | Segunda ejecución | Respuestas completas coincidentes |
| --- | --- | --- | --- |
| Fórmula de control y contrapruebas | 1099–1222 | 1266–1389 | 124/124 |
| Anulación de depósito gastado | 1223–1238 | 1390–1405 | 16/16 |
| Precedencia de errores e IDs | 1239–1249 | 1406–1416 | 11/11 |
| Anulación de transferencia gastada | 1250–1265 | 1417–1432 | 16/16 |

## Hallazgos confirmados

| ID | Comportamiento | Evidencia (IDs del log) | Confianza |
| --- | --- | --- | --- |
| AIS-01 | La fórmula de control continúa funcionando: 59 casos válidos y 63 contrapruebas por ejecución, **244 comprobaciones sin fallos**. En aislamiento, los comandos conocidos válidos tuvieron éxito; no se aceptó E401/E402 como sustituto del éxito esperado. | 1100–1221, 1267–1388 | confirmado |
| AIS-02 | Las 40 altas válidas de cada batería de control generaron AC-0001…AC-0040 consecutivamente. Las operaciones generaron OP-0001…OP-0004. No hubo reinicios de IDs sin reset registrado ni saltos inesperados. | 1100–1221, 1267–1388 | confirmado |
| AIS-03 | Tras depositar 12345 y 75, transferir 2345 y 7 en direcciones opuestas y anular ambas transferencias, los saldos volvieron a 12345 y 75. | 1116–1130, 1283–1297 | confirmado |
| AIS-04 | Anular el depósito gastado sigue dejando el saldo del origen en -200000 y el de la otra cuenta en 201400. Repetir la anulación no duplica el efecto. | 1223–1238, 1390–1405 | confirmado |
| AIS-05 | Anular la transferencia gastada sigue llevando los saldos de (160000, 90000) a (260000, -10000). Repetir la anulación no modifica esos saldos. | 1250–1265, 1417–1432 | confirmado |
| AIS-06 | En las transferencias probadas, cuenta inexistente precede a límite excedido, que precede a fondos insuficientes. Esos errores no consumen IDs de operación. | 1239–1249, 1406–1416 | confirmado |

Las tres secuencias de estado también coinciden íntegramente con sus líneas base históricas: `exploracion-02-estado-1`, `exploracion-02-precedencia-1` y `exploracion-03-reversa-transfer-1`.

La fórmula no necesitó modificaciones. La interferencia observada cuando el token estaba compartido desapareció en esta ronda. Esto confirma los casos ensayados; no demuestra todos los comportamientos posibles ni implica que ya exista un reemplazo implementado.

## Artefactos y reproducción

- `docs/evidencia-aislamiento.json`: métricas, secuencias, ventanas temporales e IDs.
- `pruebas/aislamiento/08-sin-concurrencia.json`: plan efectivo con hipótesis por solicitud.
- `pruebas/aislamiento/08-fixtures.jsonl`: respuestas completas vinculadas a la evidencia.
- `scripts/recheck_isolated.py`: recolector y verificador. Sin argumentos verifica la evidencia local y regenera métricas y fixtures, **sin llamar al original**:

```sh
python3 scripts/recheck_isolated.py
```

La opción `--run` consume requests del original y requiere el token por stdin. El recolector rechaza sobrescribir el plan existente: una nueva ronda debe usar un nombre de plan y un prefijo de secuencia distintos.
