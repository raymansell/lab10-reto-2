# Arquitectura del reemplazo de Caja Negra

La arquitectura es propuesta. No representa la implementación interna del original.

## Ejecución

```mermaid
flowchart LR
    C[Cliente o evaluador] -->|HTTP y Bearer del equipo| H
    subgraph P[Un proceso y una instancia del reemplazo]
      H[Adaptador HTTP
Ruta método auth cuerpo] --> V[Reglas del protocolo
Integridad aridad rama PING]
      V --> M[Motor de comandos
Transición determinista]
      R[Perfil de reglas versionado] -.-> V
      M <-->|Lee y aplica cambios seriales| S[Estado en memoria
Cuentas operaciones IDs]
      H -.->|Reset autenticado| S
      H -->|Health y errores de entrada| O[Serializador exacto]
      V -->|Error| O
      M -->|Status y cuerpo| O
    end
    O -->|Respuesta| C
```

## Exploración y pruebas

```mermaid
flowchart LR
    Q[Hipótesis y recolector propio] -->|Sondas con reset y token de participante| B[Original]
    B -->|Respuesta| Q
    Q --> E[experimentos.jsonl]
    E --> R[Reglas candidatas
IDs confianza versión]
    R --> N[Implementar reemplazo]
    E --> F[Fixtures versionadas desde reset]
    T[100 secuencias nuevas
40 de 1 paso
45 de 2 a 5
15 de 6 a 12] --> D[Comparador exacto]
    F -->|Esperado| D
    D -->|Reset y requests en orden| N
    N -->|Respuesta real| D
    D --> Z[Reporte por secuencia
Fallas y latencia]
    Z -.->|Reducir fallo y repetir hipótesis| Q
```

Durante la evaluación el reemplazo no consulta al original. La validación usa fixtures del original o sondas nuevas fuera del proceso del reemplazo, con reset e identidad independientes.

Decisiones D1 a D6 y objetivos de aceptación: ver 01-diseno-servicio.md.
