# Exploración del servicio existente · primera ronda

Fecha: 10 de octubre de 2026, 12:16:19–12:19:22, America/Bogota.

**Actualización posterior:** la fórmula de control pendiente en esta primera ronda se resolvió en [04-formula-control.md](04-formula-control.md). Este documento conserva las observaciones y el estado de conocimiento de la primera ronda.

Se enviaron **214 requests nuevos**, IDs **77–290** de `experimentos.jsonl`, sin respuestas marcadas como infraestructura. El log acumula 290 requests. El último request restableció el estado del token. El intento inicial de conexión desde el entorno restringido falló al resolver DNS, antes de obtener una respuesta HTTP; no se cuenta como una sonda del servicio.

Esta es una especificación parcial basada en observaciones, separada de los documentos de diseño. **Confirmado** significa repetido para los casos descritos; no demuestra todos los valores posibles. **Probable** identifica una inferencia pendiente. No hay reemplazo implementado ni medición de equivalencia contra él.

## Resultado de la verificación

- Replay actual de los ejemplos: **20/20**, IDs 78–97. Coincide con los replays previos de la mañana.
- Secuencia de anulación de depósito repetida desde reset: **16/16** respuestas iguales.
- Secuencia de precedencia de errores repetida desde reset: **11/11**.
- Matriz de entrada repetida desde reset: **44/44**.
- Secuencia de anulación de transferencia repetida desde reset: **16/16**.
- Siete casos de error de control se repitieron con idéntica respuesta. El caso válido intercalado creó `AC-0001` y luego `AC-0002`, como corresponde a la misma secuencia sin reset intermedio.

Los conteos de secuencias incluyen sus resets. Estas son sondas diagnósticas, no el banco de 100 secuencias propuesto en el diseño; algunas exceden las 12 llamadas de los tests ocultos.

## 1. Entrada HTTP

| ID | Comportamiento | Evidencia (IDs del log) | Confianza |
| --- | --- | --- | --- |
| ENT-01 | `GET /health` y `POST /__reset`, autorizados, responden 200 `{"ok":true}`, incluso con cuerpo `{` mal formado. | 194, 195, 238, 239 | confirmado |
| ENT-02 | `POST /msg` con cuerpo `{` y auth ausente o inválida responde 401 `E001` antes de analizar JSON. | 191, 192, 235, 236 | confirmado |
| ENT-03 | Una ruta desconocida sin auth y con JSON inválido responde 404 `E404`. El reconocimiento de ruta precede a auth/cuerpo en este caso. | 193, 237; también 6, 7 | confirmado |
| ENT-04 | `/health?x=1` y `/msg?x=1` conservan el comportamiento de sus rutas. `/health/` y `/msg/` responden 404 `E404`. | 184–187, 228–231 | confirmado |
| ENT-05 | `PUT /msg`, `POST /health` y `GET /__reset` responden 404 `E404`. | 188–190, 232–234 | confirmado |
| ENT-06 | Raíces JSON `null`, `true`, `42`, `"PING;64"`, `[]`, `{}` y `m` de tipo booleano/array/objeto responden 400 `E102`. | 174–182, 218–226 | confirmado |
| ENT-07 | Un campo extra junto a `m` válido se ignora en el caso probado. | 73, 183, 227 | confirmado |

Pendientes: límites de bytes y longitud, tipos de contenido, cuerpo ausente, codificación, cabeceras de autenticación alternativas y otros métodos/rutas.

## 2. Integridad y parser

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| INT-01 | `PING` sin separador devuelve `E103`; `PING;`, `ping;`, `;0`, `ALTA;;82` y `PING;;XX` devuelven `E104`. Los segmentos vacíos se rechazan antes de ejecutar PING. | 61; 154, 157, 159, 198, 201, 203, 279, 281, 287, 289 | confirmado para segmentos vacíos; probable para ausencia de separador |
| INT-02 | `PING;XX` devuelve 200 `{"pong":true}`; `PING;XX;XX` devuelve `E302`. PING omite la validación del valor de control en estos casos, pero exige aridad. | 59, 155, 156, 199, 200 | confirmado |
| INT-03 | Para ALTA, `082`, `+82`, `82 `, ` 82`, `82.0`, `-1`, `100` y `003` devuelven `E201`. | 160–164, 171, 172, 204–208, 215, 216, 276, 284 | confirmado |
| INT-04 | `ALTA;Mateo;03` devuelve `E202`, aunque `ALTA;Mateo;3` funciona. `99` y `00` en ALTA/Lucia también llegan a `E202`. Formato válido no implica equivalencia numérica del control. | 274–278, 282–286 | confirmado |
| INT-05 | El formato podría ser uno o dos dígitos ASCII y la comparación del control podría ser textual canónica. No se ha demostrado la expresión exacta ni su rango matemático. | 160–164, 274–278, 282–286 | probable |
| INT-06 | `alta;Lucia;82`, `ALTA;lucia;82`, `ALTA;Lucia ;82` y `ALTA; Lucia;82` crean cuentas. | 165, 166, 168, 169, 209, 210, 212, 213 | confirmado |
| INT-07 | ` ALTA;Lucia;82` llega a `E301` con `sugerencia: "ALTA"`; `CONSULTA;ac-0001;14` llega a `E401` pese a existir `AC-0001`. No aplicar una normalización global común a integridad y ejecución. | 165, 167, 173, 209, 211, 217 | confirmado |
| INT-08 | La validación del control parece ignorar algunas diferencias de mayúsculas y espacios que sí importan al ejecutar comandos o buscar cuentas. La fórmula completa sigue sin resolverse. | 165–169, 173, 209–213, 217 | probable como regla general |
| INT-09 | Un segmento con un espacio no se clasifica igual que un segmento vacío: `ALTA; ;82` produce `E202`, `ALTA;;82` produce `E104`. | 279, 280, 287, 288 | confirmado |

Los controles conocidos permiten explorar transiciones, pero **no permiten todavía construir mensajes arbitrarios válidos**. Las fórmulas simples ensayadas localmente no explican todos los ejemplos y no se promueven a reglas.

## 3. Comandos

| ID | Comando y comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| CMD-01 | PING: 200 `{"pong":true}`; excepciones de formato/aridad descritas arriba. | 78, 155, 156, 199, 200 | confirmado |
| CMD-02 | ALTA con nombres conocidos crea cuentas consecutivas con 201 `{"cuentaId":"AC-0001"}`. El mismo nombre puede repetirse y crea otra cuenta. | 57, 58, 100, 101, 127, 128, 275, 283 | confirmado |
| CMD-03 | CONSULTA: 200 `{"cuenta_id":"AC-0001","saldo":0}` para la cuenta recién creada; cuenta inexistente: 404 `E401`. Conserva `cuenta_id`, distinto de `cuentaId` de ALTA. | 17, 27, 38, 48, 82, 92, 173, 217 | confirmado |
| CMD-04 | DEPOSITO de 250000 en AC-0001 o 700 en AC-0002 suma el importe y crea operación. Responde 200 `{"status":"recieved","operacionId":"OP-0001"}`; conservar la errata `recieved`. | 83, 95, 102–114, 129–141 | confirmado para importes probados |
| CMD-05 | TRANSFER descuenta al origen y acredita al destino. Se observaron éxitos con 40000, 50000 y 100000, y rechazo por límite con 120000 incluso con fondos. | 84–88, 123–125, 150–152, 244–249, 260–265 | confirmado para importes probados |
| CMD-06 | ANULA sobre un depósito resta su importe aun si fue gastado: saldo 50000 → -200000 al anular depósito de 250000. La otra cuenta mantiene 201400. | 104–111, 131–138 | confirmado |
| CMD-07 | ANULA sobre transferencia devuelve el importe al origen y lo resta al destino aun sin fondos: saldos (160000, 90000) → (260000, -10000). | 248–252, 264–268 | confirmado |
| CMD-08 | ANULA repetida responde 200 `{"ok":false,"motivo":"ya anulada"}` sin volver a modificar saldos. Operación ausente: 404 `E402`. | 116, 143, 250–255, 266–271 | confirmado |

El límite exacto de TRANSFER sigue pendiente: aceptar 100000 y rechazar 120000 no demuestra por sí solo que el máximo sea exactamente 100000. Tampoco se han establecido importes negativos, cero, decimales, autoenvío, límites de DEPOSITO, validación de nombres o todos los comandos posibles.

## 4. Memoria entre requests

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| MEM-01 | Los resets probados eliminan operaciones y reinician los IDs de cuentas y operaciones. | 115–125, 142–152, 241–246, 257–262 | confirmado |
| MEM-02 | Errores E401/E506/E507 de TRANSFER no consumieron IDs de operación: después de ellos, DEPOSITO fue OP-0001 y TRANSFER válida OP-0002. | 117–125, 144–152 | confirmado |
| MEM-03 | Anular OP-0003 y repetir su anulación no consumió otro ID: tras OP-0005, el siguiente depósito fue OP-0006. | 106–113, 133–140 | confirmado |
| MEM-04 | Las operaciones conservan el efecto original necesario para revertirlas después de movimientos posteriores; la segunda anulación consulta una marca persistente. | 104–114, 131–141, 244–255, 260–271 | confirmado en secuencias observadas |
| MEM-05 | X-Req no vuelve a cero con reset en la exploración histórica. Los headers no se comparan en la evaluación, según README. | 33–34, 54–55 | probable sobre el ámbito exacto del contador |

## 5. Errores y precedencia

Todos los siguientes cuerpos son objetos JSON exactos. El espacio final de `comando desconocido ` es parte del valor.

| Error | HTTP | Cuerpo | Evidencia | Confianza |
| --- | --- | --- | --- | --- |
| E001 | 401 | `{"error":"E001","mensaje":"no autorizado"}` | 191, 192, 235, 236 | confirmado |
| E100 | 400 | `{"error":"E100","mensaje":"json inválido"}` | 74 | probable: una observación histórica |
| E102 | 400 | `{"error":"E102","mensaje":"falta m"}` | 174–182, 218–226 | confirmado |
| E103 | 400 | `{"error":"E103","mensaje":"falta control"}` | 61, 72 | probable: dos entradas históricas distintas, sin repetición |
| E104 | 400 | `{"error":"E104","mensaje":"segmento vacío"}` | 154, 198, 279, 287 | confirmado |
| E201 | 400 | `{"error":"E201","mensaje":"control mal formado"}` | 160–164, 204–208 | confirmado |
| E202 | 400 | `{"error":"E202","mensaje":"control inválido"}` | 274, 277, 278, 282, 285, 286 | confirmado |
| E301 | 400 | `{"error":"E301","mensaje":"comando desconocido "}`; en ` ALTA`, añade `"sugerencia":"ALTA"` | 89, 167, 211; antes 24, 45 | confirmado para casos probados |
| E302 | 400 | `{"error":"E302","mensaje":"aridad inválida"}` | 97, 156, 200 | confirmado |
| E401 | 404 | `{"error":"E401","mensaje":"cuenta inexistente"}` | 117, 119, 144, 146 | confirmado |
| E402 | 404 | `{"error":"E402","mensaje":"operación inexistente"}` | 116, 143 | confirmado |
| E404 | 404 | `{"error":"E404","mensaje":"ruta desconocida"}` | 185, 187–190, 229, 231–234 | confirmado |
| E506 | 422 | `{"error":"E506","mensaje":"límite excedido"}` | 121, 124, 148, 151 | confirmado |
| E507 | 422 | `{"error":"E507","mensaje":"saldo insuficiente"}` | 122, 149 | confirmado |

Orden parcial observado, no cadena completa para todas las entradas:

1. Reconocimiento de ruta/método → autenticación → JSON para POST /msg: 191–193, 235–237 y 74.
2. Segmento vacío → rama PING; PING evita formato/valor del control pero comprueba aridad: 154–156, 198–200, 281, 289.
3. En las sondas históricas no PING, control incorrecto → comando desconocido/aridad/cuenta: 63–67, frente a 24, 32, 45, 53, 89, 92, 97. Falta repetir los cruces exactos en una ronda posterior.
4. En TRANSFER con integridad válida: existencia de cuentas → límite → fondos: 117–125 y 144–152.

## 6. Cambios durante el día

| ID | Comportamiento | Evidencia | Confianza |
| --- | --- | --- | --- |
| VER-01 | No se detectó cambio en los 20 ejemplos entre la línea base de 11:15–11:16 y el replay de 12:16, hora de Bogotá. | 12–53, 77–98 | confirmado solo para esos ejemplos |

No equivale a asegurar que el resto del servicio no cambió. Conservar los planes como centinelas de futuras rondas.

## 7. Riesgos y siguientes experimentos

| ID | Comportamiento a replicar / riesgo | Evidencia | Confianza |
| --- | --- | --- | --- |
| RIE-01 | Las anulaciones permiten saldos negativos. Un servicio nuevo con otro contrato podría validar fondos o modelar deuda explícitamente; el reemplazo de este reto debe reproducir la reversión observada. | 109–111, 136–138, 250–252, 266–268 | confirmado |
| RIE-02 | Integridad y ejecución tratan de manera distinta espacios/capitalización. Normalizar toda la entrada alteraría respuestas observadas. | 165–173, 209–217 | confirmado |
| RIE-03 | Convertir el control a número haría equivalentes `03` y `3`, en contra del original. | 274, 275, 282, 283 | confirmado |
| RIE-04 | Corregir `recieved`, cambiar nombres de campos o quitar el espacio del error E301 rompería la igualdad de cuerpos. | 83, 89, 95, 167, 211 | confirmado |

Prioridad para la siguiente ronda:

1. Resolver la fórmula de control y su normalización por campo. Validar predicciones en al menos diez mensajes nuevos de distintos comandos y rechazar controles alterados.
2. Medir el límite exacto de transferencia, formatos numéricos, cero/negativos, autoenvío y anulación de operaciones fallidas.
3. Completar límites HTTP, nombres, aridad de cada comando y algoritmo de sugerencias.
4. Con reglas suficientes, construir el motor determinista y ejecutar las fixtures contra él; posteriormente crear el banco independiente de 100 secuencias.

## Reproducción y artefactos

- `pruebas/planes/01-replay.json`, `02-estado-entrada.json`, `03-confirmacion.json`: solicitudes e hipótesis, incluidos cuerpos raw, método, ruta y modo de auth. Cada secuencia comienza con reset; una sonda adicional a /__reset dentro de la matriz de entrada también reinicia el estado.
- `experimentos.jsonl`: evidencia original con fecha, X-Req, status, cuerpo exacto y señal de infraestructura. Los IDs son números de línea.
- `pruebas/exploracion-observada.jsonl`: 214 fixtures que vinculan cada caso del plan con su evidencia y respuesta. Los planes distinguen JSON `null`, cuerpo ausente y texto raw.
- `docs/evidencia-exploracion.json`: métricas de esta ronda; conserva por separado la medición histórica de diseño.
- `python3 scripts/verify_exploration.py`: verifica localmente planes, integridad del log, replay y repeticiones, y regenera las fixtures y métricas. No consume cuota del original.

Para repetir contra el original, ejecutar `python3 scripts/explore_design.py pruebas/planes/<plan>.json` suministrando el token por stdin, fuera del repositorio. Usar nombres de secuencia nuevos si se conserva el mismo log: el verificador de esta ronda espera una sola ejecución por nombre. Ejecutar un solo recolector por token y revisar la cuota antes de repetir. Las credenciales no forman parte de estos artefactos.
