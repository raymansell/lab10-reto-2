# Fórmula del control de Caja Negra

**Revalidación posterior con token exclusivo:** otras 244 comprobaciones de control sin fallos y 167/167 pares de respuestas completas idénticas, incluidos saldos e IDs en las secuencias de estado. No se observaron reinicios inesperados. Véase [05-revalidacion-aislada.md](05-revalidacion-aislada.md).

**Resultado:** fórmula confirmada en dos ejecuciones de 59 controles válidos y 63 contrapruebas: **244/244 comprobaciones**. Incluye los cinco comandos que validan control, comandos desconocidos, aridad incorrecta, símbolos, Unicode y cadenas de 160 caracteres. Se registraron 808 requests nuevos, IDs 291–1098, incluidos búsqueda, hipótesis inicial y resets; el log acumula 1098 requests. Ninguno llevó una marca de infraestructura.

El control se calcula sobre el mensaje **sin el último punto y coma ni su campo de control**. Para las entradas comprobadas:

1. Conservar únicamente letras ASCII `A–Z`, `a–z` y dígitos ASCII `0–9`; ignorar los demás caracteres **antes** de convertir mayúsculas.
2. Conservar cada dígito y convertir las letras ASCII a su posición sin distinguir mayúsculas: `A/a → 1`, …, `Z/z → 26`.
3. Concatenar las representaciones decimales, sin separadores.
4. Añadir `00` al final y calcular el resto módulo 97.
5. El control es `98 − resto`, representado en decimal **sin ceros iniciales**.

Sea `D` la secuencia decimal transformada, interpretada como cero cuando está vacía:

```text
control = decimal(98 − ((D × 100) mod 97))
mensaje = payload + ";" + control
```

## Ejemplo completo

```text
ALTA;Lucia
ALTA;LUCIA                   mayúsculas
A L  T  A  L  U  C I A      ignorar el separador
1 12 20 1 12 21 3 9 1       sustituir letras
112201122139100              concatenar y añadir 00
112201122139100 mod 97 = 16
98 − 16 = 82

Mensaje válido: ALTA;Lucia;82
```

## Implementación sin pérdida de precisión

No convertir toda la concatenación a un `Number` de JavaScript: puede exceder su precisión exacta. Basta mantener un resto de 0 a 96 y procesar los dígitos de uno en uno. La implementación Python reutilizable está en `scripts/control.py`.

Equivalente para el servicio Node.js propuesto:

```js
export function control(payload) {
  let remainder = 0;
  for (const char of payload) {
    let digits;
    if (char >= '0' && char <= '9') {
      digits = char;
    } else if (char >= 'A' && char <= 'Z') {
      digits = String(char.charCodeAt(0) - 64);
    } else if (char >= 'a' && char <= 'z') {
      digits = String(char.charCodeAt(0) - 96);
    } else {
      continue;
    }
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return String(98 - (remainder * 100) % 97);
}
```

El rango matemático es **2–98**, incluidos ambos extremos. `32` produce `2`; `97`, `000` y `!!!` producen `98`. El servicio aún puede rechazar esos mensajes por comando desconocido: pasar integridad no implica que un comando exista.

## Diferencias entre cálculo y ejecución

- Calcular el control sobre las mayúsculas no autoriza a modificar los argumentos al ejecutar: `CONSULTA;ac-0001;14` pasa integridad pero devuelve cuenta inexistente, mientras `AC-0001` existe (log 173, 217).
- No convertir el control recibido a número para compararlo: `ALTA;Mateo;03` falla con E202 y `ALTA;Mateo;3` funciona (274, 275, 282, 283).
- La normalización no translitera acentos: los caracteres no ASCII se omiten. No convertir `é` en `E` ni aplicar normalización Unicode adicional.
- El orden importa para Unicode: `ß`, `ı` y `ſ` se descartan; convertirlos antes a `SS`, `I` y `S` produce controles incorrectos. Las formas precompuesta `é` y descompuesta `e` + acento combinante pueden producir controles diferentes.
- Los signos y separadores omitidos siguen existiendo para el parser de comandos. No eliminar signos o espacios de la solicitud original al ejecutar.
- PING constituye una excepción de validación: `PING;XX` responde pong. Esta fórmula calcula `64` para PING, pero no se debe exigir ese valor en esa rama (59, 155, 199).
- Conservar las validaciones previas: por ejemplo, un segmento vacío produce E104 antes de evaluar la fórmula (279, 281, 287, 289).

La concatenación pierde las fronteras entre caracteres y campos: `A1` y `K` contribuyen ambos `11`. Este campo es un control de integridad débil, no una firma ni una garantía de autenticidad. El reemplazo debe conservar su comportamiento observado.

## Evidencia y verificación

La búsqueda acotada de controles produjo pares mínimos independientes:

| Payload | Control observado y predicho | ID del log |
| --- | --- | --- |
| A | 95 | 387 |
| B | 92 | 480 |
| C | 89 | 570 |
| AA | 65 | 636 |
| AB | 62 | 699 |
| BA | 35 | 735 |

La fórmula coincide con todos los controles válidos de `pruebas/ejemplos.jsonl` y distingue sus controles mal formado e incorrecto. Los pares mínimos no son la única evidencia: las predicciones para comandos nuevos, casos de normalización y controles alterados se escribieron antes de enviarlos al original.

La primera hipótesis, `05-predicciones.json`, aplicaba mayúsculas antes del filtro ASCII: acertó 52 de 56 controles válidos y los 56 controles alterados, pero falló en cuatro casos Unicode (806, 808, 812, 840). Se conserva como hipótesis **refutada en su normalización**, junto con su informe de fallos. Las predicciones corregidas se encuentran en `06-predicciones-corregidas.json`; no se reescribieron las predicciones iniciales para hacerlas coincidir con los resultados.

El resultado detallado de cada ejecución se conserva en los archivos `*.verification.json` de `pruebas/control`; sus fixtures vinculan predicción, solicitud, status, respuesta e ID del log. El log original sigue siendo `experimentos.jsonl`.

| ID | Comportamiento | Evidencia (IDs del log) | Confianza |
| --- | --- | --- | --- |
| CTRL-01 | Concatenación de A/a=1…Z/z=26 y dígitos, seguida por `98 − ((D × 100) mod 97)`. | 387, 480, 570, 636, 699, 735; casos y contrapruebas 852–973, 976–1097 | confirmado en el corpus probado |
| CTRL-02 | Un control alterado se rechaza con HTTP 400 y cuerpo exacto `{"error":"E202","mensaje":"control inválido"}`. | 63 casos en 852–973 y los mismos 63 en 976–1097; IDs individuales en los informes JSON | confirmado |
| CTRL-03 | Los caracteres no ASCII se omiten antes de cualquier expansión de mayúsculas; `ß`, `ı`, `ſ` y ligaduras no aportan letras. | 920, 922, 926, 954, 964–972; 1044, 1046, 1050, 1078, 1088–1096 | confirmado para caracteres probados |
| CTRL-04 | Acento precompuesto y combinante se tratan distinto: `ALTA;é` usa 85 y `ALTA;é` usa 50. | 928–931, 1052–1055 | confirmado |
| CTRL-05 | Signos, separadores, espacios, tabulaciones y saltos probados no contribuyen al control. | 892–913, 958–961, 1016–1037, 1082–1085 | confirmado para símbolos probados |
| CTRL-06 | Los extremos 2 y 98 se aceptan en integridad; los valores alterados se rechazan. | 950–953, 1074–1077 | confirmado |
| CTRL-07 | La pérdida de fronteras produce colisiones: ALTA con nombre A1 y con nombre K usa el mismo control 26. | 858–861, 982–985 | confirmado |
| CTRL-08 | El cálculo conserva precisión para los payloads probados con nombres de 160 letras o dígitos. | 946–949, 1070–1073 | confirmado para esas longitudes |

No se infiere un límite de tamaño a partir de CTRL-08. Los cuatro tests locales verifican ejemplos, pares descubiertos, fixtures confirmadas y aritmética incremental frente a un entero exacto de 1002 dígitos. El ejemplo JavaScript de este documento también se ejecutó contra las 244 predicciones confirmadas, sin discrepancias.

El usuario confirmó que otra sesión utiliza el mismo token. Se observaron IDs de cuenta reiniciados durante la validación corregida (por ejemplo, 860 → 888 y 906 → 908), sin reset de este recolector entre esos puntos. Por ello, estas sondas demuestran aceptación/rechazo de **integridad**, no aislamiento ni equivalencia de las transiciones de estado. Un control correcto puede llegar a E401/E402 si la otra sesión cambió las cuentas u operaciones. Las pruebas de estado deberán coordinar el uso exclusivo del token o emplear tokens separados.

Verificaciones locales, sin llamadas al original:

```sh
python3 scripts/verify_control.py pruebas/control/06-predicciones-corregidas.json 06-validacion-corregida
python3 scripts/verify_control.py pruebas/control/06-predicciones-corregidas.json 07-repeticion
python3 -m unittest discover -s pruebas -p 'test_control.py' -v
```

## Alcance de la conclusión

La fórmula permite construir mensajes nuevos sin barrer controles. No resuelve las reglas de importes, nombres, límites HTTP o sugerencias. Los resultados de normalización describen los caracteres comprobados; no equivalen a una prueba exhaustiva de todas las entradas ni de todos los tamaños posibles.
