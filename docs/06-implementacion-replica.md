# Réplica inicial: ejecución, cobertura y supuestos

Implementación local en Node.js 24.11.1, sin dependencias de terceros. El proceso de ejecución solo carga módulos de `src/`: no lee fixtures, no importa los recolectores y no realiza llamadas al original. Los documentos 01–05 conservan el diseño y las observaciones históricas.

## Ejecutar

```sh
nvm use
REPLICA_TOKEN=local-demo npm start
```

Escucha por defecto en `127.0.0.1:3000`. `REPLICA_TOKEN` es obligatorio; para desarrollo se puede elegir un token local. Para evaluación habrá que configurar el token del equipo, que es distinto del token de exploración. `PORT` admite valores de 1 a 65535; `HOST=0.0.0.0` permite escuchar en todas las interfaces al desplegar. Se requiere un solo proceso/instancia para conservar las secuencias en memoria.

También se puede copiar `.env.example` a `.env`, editar sus valores y ejecutar `node --env-file=.env src/main.mjs`. El archivo `.env` está excluido de Git. No hay dependencias que instalar para arrancar o probar; `package-lock.json` registra el paquete sin dependencias y `.nvmrc` fija el runtime utilizado.

```sh
curl -H 'Authorization: Bearer local-demo' http://127.0.0.1:3000/health
curl -H 'Authorization: Bearer local-demo' -H 'Content-Type: application/json' \
  -d '{"m":"ALTA;Lucia;82"}' http://127.0.0.1:3000/msg
curl -X POST -H 'Authorization: Bearer local-demo' http://127.0.0.1:3000/__reset
```

Las respuestas respectivas son `{"ok":true}`, `{"cuentaId":"AC-0001"}` si se parte de estado inicial y `{"ok":true}`.

## Verificación realizada

`npm test` ejecuta siete pruebas, incluida la regresión HTTP. **1204/1204 respuestas y 25/25 secuencias coinciden**: 1184 requests históricos seleccionados más los 20 ejemplos entregados. Se comparan status y cuerpo, manteniendo tipos, orden de arrays, espacios y erratas. Se verifica que cada entrada del plan corresponda a su entrada original en el log; cada secuencia arranca con reset.

Se excluyen explícitamente las 248 respuestas de `06-validacion-corregida` y `07-repeticion` porque el token estaba compartido y su estado sufrió interferencias. La validación aislada 08 sí está incluida íntegramente. La secuencia 05 se compara contra sus **respuestas observadas**, incluidas las cuatro predicciones Unicode refutadas, que la réplica también rechaza.

Además se verifican precisión del control con un entero de 10000 dígitos, reset completo, 40 depósitos HTTP concurrentes sin perder actualizaciones, independencia de instancias, token obligatorio y ausencia de mutaciones parciales ante los fallbacks numéricos. Los tests de supuestos comprueban consistencia del reemplazo; no convierten esos supuestos en hechos del original.

El informe reproducible queda en `output/verification/replica-regression.json`. `npm run test:regression` ejecuta solo el comparador y regenera el informe; `npm test` también lo guarda. Ninguna de las dos órdenes consume requests del original. La latencia registrada es exclusivamente de localhost. Este corpus incluye repeticiones y secuencias largas; **no equivale al banco independiente de 100 secuencias ni al set oculto**. No se ha desplegado esta versión.

## Módulos

| Archivo | Responsabilidad |
| --- | --- |
| `src/main.mjs` | Configuración, arranque y cierre del proceso. |
| `src/http.mjs` | Ruta/método, token, lectura del cuerpo, JSON y respuesta HTTP. |
| `src/control.mjs` | Cálculo incremental del control sin desbordar precisión. |
| `src/protocol.mjs` | Parser, precedencia de integridad, aridad y sugerencias. |
| `src/state.mjs` | Cuentas, operaciones, contadores, transferencias y anulaciones. |
| `src/responses.mjs` | Status y cuerpos, incluidas las inconsistencias observadas. |

## Especificación parcial implementada

Los IDs de evidencia corresponden a líneas de `experimentos.jsonl`. **Confirmado** limita su alcance a los casos probados; los valores no explorados se identifican como **supuestos** más abajo.

### 1. Entrada

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-E01 | GET /health y POST /__reset autorizados responden 200 `{"ok":true}`; ignoran el cuerpo, incluso JSON mal formado. | 194, 195, 238, 239 | confirmado |
| IMP-E02 | Ruta/método desconocidos responden E404 antes de auth; /msg sin auth o con token incorrecto responde E001 antes de JSON. | 191–193, 235–237, 188–190, 232–234 | confirmado |
| IMP-E03 | Query en /msg y /health no cambia la ruta; barra final sí produce E404. | 184–187, 228–231 | confirmado |
| IMP-E04 | POST /msg exige JSON con `m` string; ignora campos adicionales. JSON mal formado produce E100; `m` ausente o de tipos probados produce E102. | 74, 174–183, 218–227 | confirmado para tipos repetidos; probable para JSON inválido observado una vez |

### 2. Integridad

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-I01 | Separar por `;`; sin separador, E103; segmento exactamente vacío, E104. No quitar espacios globalmente. | 61, 72, 154, 198, 279, 287 | confirmado para segmentos vacíos; probable para ausencia de separador |
| IMP-I02 | Salvo PING, formato de control de uno o dos dígitos ASCII; comparación textual con la fórmula de `04-formula-control.md`. `03` no equivale a `3`. | 160–172, 204–216, 274–286, 1100–1221, 1267–1388 | confirmado en el corpus; generalización del formato probable |
| IMP-I03 | PING evita formato y valor del control, pero mantiene segmentos no vacíos y aridad cero. | 155, 156, 199, 200, 281, 289 | confirmado |
| IMP-I04 | Capitalización del comando no cambia ejecución; espacios iniciales sí. Los argumentos conservan su texto al ejecutarse. | 165–173, 209–217 | confirmado en casos probados |

### 3. Comandos

#### PING

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-C01 | Cero argumentos, HTTP 200 `{"pong":true}`. | 13, 34, 78, 155, 199 | confirmado |

#### ALTA

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-C02 | Un nombre crea cuenta de saldo cero y HTTP 201 con `cuentaId`; nombres repetidos crean cuentas distintas. | 57, 58, 82, 275, 283, 1100–1221, 1267–1388 | confirmado para nombres probados |

#### CONSULTA

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-C03 | Un ID exacto responde 200 con `cuenta_id` y `saldo`; ausente, E401. Se conservan los saldos negativos. | 17, 38, 110, 137, 173, 217 | confirmado |

#### DEPOSITO

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-C04 | ID e importe acreditan saldo y crean OP; respuesta 200 con `status: "recieved"` y `operacionId`. | 83, 95, 1116, 1118, 1283, 1285 | confirmado para importes probados |

#### TRANSFER

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-C05 | Origen, destino e importe descuentan/acreditan y crean OP con la misma respuesta de DEPOSITO. Cuentas inexistentes → límite → fondos. | 117–125, 144–152, 1120, 1122, 1287, 1289 | confirmado para importes/casos probados |

#### ANULA

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-C06 | Un ID de operación invierte el efecto original, aun produciendo negativos: 200 `{"ok":true,"anulada":"OP-…"}`. Ausente: E402. Repetida: 200 `{"ok":false,"motivo":"ya anulada"}`, sin otro efecto. | 116, 143, 1223–1238, 1250–1265, 1390–1405, 1417–1432 | confirmado |

### 4. Memoria

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-M01 | Reset borra cuentas, operaciones y marcas de anulación; contadores vuelven a AC-0001 y OP-0001. | 115–125, 142–152, 1099–1432 | confirmado |
| IMP-M02 | Errores de integridad y los errores de transferencia probados no consumen IDs; anular no crea otra operación. | 56–58, 106–113, 117–125, 133–140, 144–152 | confirmado |

### 5. Errores

Los cuerpos exactos y sus IDs históricos están catalogados en la sección 5 de `03-exploracion-servicio.md`; `src/responses.mjs` conserva esos valores. Esta implementación incluye E001, E100, E102, E103, E104, E201, E202, E301, E302, E401, E402, E404, E506 y E507.

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-X01 | En /msg: ruta/método → auth → JSON → tipo de m → separador → segmentos vacíos → control salvo PING → comando → aridad → ejecución. | 63–67, 74, 154–156, 191–193, 198–200, 235–237 | orden parcial confirmado; interacciones no cruzadas son supuesto S-07 |
| IMP-X02 | E301 conserva el espacio final de `comando desconocido `; sugerencia ALTA para `AA`/` ALTA` y PING para ` PING`. | 69, 167, 211, 636 | confirmado para esas entradas |

### 6. Versiones y cambios

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| IMP-V01 | La versión local 0.1.0 reproduce el corpus histórico seleccionado: 1204 pasos y 25 secuencias. | IDs 1–850 y 1099–1432; 20 ejemplos; informe local de regresión | confirmado para ese corpus |
| IMP-V02 | Excluir las secuencias contaminadas preserva el aislamiento de las pruebas de estado; la evidencia aislada 08 respalda los contadores. | 851–1098 excluidos; 1099–1432 incluidos | confirmado |

No se enviaron nuevas solicitudes al original durante la implementación. Los hechos históricos no certifican que el original siga igual después de su ventana de observación.

### 7. Riesgos y supuestos activos

| ID | Comportamiento o elección del reemplazo | Evidencia / motivo | Confianza |
| --- | --- | --- | --- |
| S-01 | Máximo por transferencia: 100000, inclusive. Sin límite acumulado adicional. | Se aceptaron 100000 y rechazaron 120000; falta localizar el umbral exacto. | supuesto |
| S-02 | Importes: solo dígitos ASCII, entero positivo seguro; ceros iniciales permitidos. No hay otro límite de depósito. Rechazo de otros formatos, cero y desbordamiento de importe/saldo con **422 `{"error":"E501","mensaje":"importe inválido"}`**. Comprobar existencia de cuentas antes del importe. | No se midieron esos casos. E501 y su cuerpo son **provisionales, no observados**. El rechazo no cambia saldos ni consume IDs. | supuesto |
| S-03 | Sugerencia por distancia Levenshtein ≤2; empates por orden PING, ALTA, CONSULTA, DEPOSITO, TRANSFER, ANULA. | Compatible con las sugerencias conocidas; no se dedujo el algoritmo general. | supuesto |
| S-04 | Autoenvío con fondos y dentro del límite: éxito, saldo neto cero, crea operación anulable. | No se probó contra el original. | supuesto |
| S-05 | Máximo de cuerpo de /msg: 1 MiB; exceso responde **413 `{"error":"E100","mensaje":"json inválido"}`**. No hay otro límite de `m`/nombre. | Protección local no medida en el original; respuesta del exceso provisional. | supuesto |
| S-06 | Cualquier nombre no vacío después del split se guarda literalmente; todo duplicado se admite. | Compatible con nombres repetidos, símbolos, Unicode y longitudes probadas; falta delimitar su validación completa. | supuesto fuera del corpus |
| S-07 | JSON se interpreta como UTF-8 sin exigir Content-Type; cuerpo ausente da E100; bytes inválidos usan la sustitución UTF-8 de Node. Combinaciones de validaciones no cruzadas siguen el orden IMP-X01. | No explorado fuera de los casos del corpus. | supuesto |
| S-08 | Un token configurado, comparación exacta de `Bearer <token>`; sin variantes de esquema/espaciado. Rutas por texto antes de `?`, sin normalizar puntos ni percent-encoding. Despacho del comando con `toUpperCase()`. | Variantes adicionales de HTTP, autenticación y comandos Unicode no exploradas. | supuesto fuera del corpus |
| S-09 | Estado en memoria, transiciones síncronas por orden de finalización de lectura del cuerpo. Reset se ejecuta cuando llega su solicitud. X-Req es local al proceso, solo aumenta para /msg autorizado y no se reinicia con reset. | Implementación determinista para secuencias; semántica concurrente y ámbito exacto de X-Req del original no confirmados. Los headers no se evalúan. | supuesto |
| S-10 | Errores de framing, conexiones incompletas y tiempos de espera usan el comportamiento de node:http. | No se midió el transporte fuera de HTTP válido. | supuesto |

Las anulaciones con saldo negativo, las colisiones del control y las inconsistencias de nombres de campos se conservan por compatibilidad. Para un servicio con otro contrato convendría revisar esas reglas; aquí no se corrigen. Los supuestos S-01 a S-10 son la lista de trabajo para la próxima exploración, no afirmaciones sobre el original.
