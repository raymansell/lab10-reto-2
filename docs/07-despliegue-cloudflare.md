# Despliegue de la réplica en Cloudflare

URL pública: https://caja-negra-replica.raymansell1.workers.dev

Verificación pública del 10 de octubre de 2026: **1204/1204** respuestas coincidentes, siete comprobaciones de autenticación/health, p95 **144 ms**, máximo **314 ms**. El informe está en `output/verification/cloudflare-regression.json`; el estado quedó reiniciado. Esta cobertura confirma la evidencia seleccionada, no todos los casos ocultos ni los supuestos pendientes.

Wrangler está fijado en 4.114.0. La versión 4.149.0 subió el código, pero su API de configuración de workers.dev respondió `10007` en esta cuenta; 4.148.0 comparte esa implementación. Se actualizan por overrides `sharp`, `undici` y `ws` para conservar un árbol de dependencias sin vulnerabilidades reportadas por npm. El motor publicado no incluye dependencias npm.

El entry point `src/worker.mjs` adapta el motor confirmado a Cloudflare Workers. Todas las llamadas autorizadas a `/msg` y `/__reset` usan un único Durable Object `ReplicaState`, identificado como `evaluation`. Así todas las regiones observan las mismas cuentas, operaciones y contadores. `/health` y los rechazos de autenticación se resuelven en el Worker.

El Durable Object guarda una instantánea del motor en SQLite. Cada transición lee el estado y confirma el resultado en una transacción síncrona antes de responder. Los reinicios, la expulsión de memoria y los nuevos despliegues conservan los datos; únicamente `/__reset` elimina cuentas y operaciones y reinicia sus IDs. `X-Req` se conserva entre reinicios y no cambia con reset. El adaptador Node sigue disponible para desarrollo local.

Cloudflare explica por qué el [estado en memoria de un Durable Object](https://developers.cloudflare.com/durable-objects/examples/durable-object-in-memory-state/) necesita persistencia. La configuración usa un namespace SQLite con la migración inicial `v1`; no se debe cambiar el nombre de la clase, del binding o del objeto para futuras publicaciones del mismo servicio.

## Publicación

```sh
npm ci
npm test
npx wrangler login
npm run deploy:cloudflare
npm run secret:cloudflare
```

`secret:cloudflare` lee `REPLICA_TOKEN` del entorno o del archivo local `.env` ignorado por Git y lo envía por stdin a Wrangler. No imprime el valor. Configurar el token de evaluación de la réplica; el token para explorar el original no sirve para este despliegue. El Worker responde 503 en las rutas conocidas hasta configurar el secreto. Los nuevos despliegues conservan los secretos existentes.

Wrangler publica la URL raíz `https://caja-negra-replica.<subdominio>.workers.dev`; registrar esa URL raíz para el evaluador. Se configuran únicamente las rutas del contrato: GET `/health`, POST `/msg`, POST `/__reset`. Las tres requieren el Bearer configurado. Las otras rutas conservan E404 incluso sin autorización.

## Verificación

```sh
node --env-file-if-exists=.env scripts/verify-cloudflare.mjs https://caja-negra-replica.<subdominio>.workers.dev
```

El verificador restringe su destino a la URL workers.dev de esta réplica, comprueba autenticación y reproduce las 25 secuencias del corpus seleccionado (1204 solicitudes), incluyendo cuerpos GET por transporte HTTP. Termina con reset y guarda `output/verification/cloudflare-regression.json`, sin credenciales. No envía solicitudes al original.

`npm test` valida ambos adaptadores y reinicia el runtime local para comprobar la persistencia de saldos, contadores y anulaciones, además de 40 depósitos concurrentes. En el test local de Workers, Fetch no permite cuerpos GET/HEAD: se omiten sus cuerpos, que esas rutas ignoran. La verificación pública utiliza HTTPS de Node y conserva dichos cuerpos.

## Límites de la adaptación

El Worker conserva los supuestos funcionales S-01 a S-07 de la especificación. Cloudflare normaliza URLs y aplica sus límites de transporte antes del código; la equivalencia fuera del corpus, por ejemplo segmentos `.`/`..`, encabezados duplicados y framing inválido, sigue sin confirmarse. S-09 pasa de memoria de proceso a SQLite persistente en este adaptador. Reset se ordena después de consumir su cuerpo. Las instantáneas completas son adecuadas para el corpus del reto; cargas con muchos miles de operaciones requerirían almacenar cuentas y operaciones por separado.

Para desarrollo del Worker, crear un `.dev.vars` ignorado con `REPLICA_TOKEN` y ejecutar `npm run dev:cloudflare`. Ese archivo no se publica; producción usa el secreto de Cloudflare.
