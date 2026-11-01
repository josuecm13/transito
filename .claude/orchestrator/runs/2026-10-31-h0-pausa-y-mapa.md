# 2026-10-31 — H0 (#1): menú de pausa + vista general del mapa

Goal: menú de pausa y mapa completo (pedido del director). Spec primero.
Issue: #1
Status: cerrado (H0 sigue abierto hasta #7).

## Decisiones (orquestador, por defecto)
- Esc abre la pausa o vuelve atrás; Tab abre el mapa; pausa automática al perder el foco.
- Pausa por "razones": mientras está en pausa no corren input/fixed/física/update; sí late/render. Sin ráfaga de recuperación al volver.
- Servicio `screens`: pila de pantallas, entradas de menú y atajos aportados por plugins. El menú no conoce el mapa.
- Mapa: istmo completo en gris con nombres de distritos del spec; área activa con detalle; solo landmarks del área activa (evita adelantar contenido de actos futuros).

## Plan
CARD-10 (pausa en motor + screens + menú + criterios en spec) → CARD-11 (pantalla del mapa).

## Cards
| Card | Agent / model | Outcome | Fix rounds |
|---|---|---|---|
| CARD-10 pausa + screens + menú | implementer / sonnet | ok — tc/99 tests/build exit 0 (orquestador); PNG revisado: panel Pausa, HUD PAUSA; W en pausa no mueve, tras reanudar sí; 2 mutaciones. Sin probar: pausa por pérdida de foco, navegación con flechas/mouse | 0 |
| CARD-11 mapa general | implementer / sonnet | detenido por el orquestador a pedido del director (escalar a Opus); dejó borrador sin verificar que compila | — |
| CARD-11 mapa general | implementer / **opus** (aprobado por el director) | ok — tc 0, 116 tests, build 0 (orquestador); PNG general y zoom revisados; 3 mutaciones. Check d falla solo en headless (primer dibujo ~2 s en SwiftShader traga keydown+keyup de W en un frame); d' con espera pasa | 0 |
| CARD-12 escala de personajes | implementer / haiku | ok — tc 0, 116 tests (orquestador); medidas sin cambio (1,80 / 1,70 m); 4 mutaciones reportadas + 1 del orquestador (peatón halfHeight 0.2 → `pedestrians are 1.55-1.85 m tall` falla; restaurado idéntico) | 0 |

## Escalations
- Director tras jugar: "la calle se ve como un grafo, no hay cuadras, ni carros, ni parques, ni edificios". Diagnóstico: el spec solo tiene arterias (1 avenida en el área activa) y el blockout llena una grilla de lotes sin red de calles ni uso de suelo. Propuesta de rediseño del mundo enviada; espera decisiones. Chrome MCP no conectado: no se pudo verificar render WebGPU en el navegador del director.
- Director aprobó Opus para el resto de la feature (mapa): "needs better output".

## Open
- #7 actualizado a pedido del director: sectores de referencia pequeños (~0,5–2 km²) declarados en el spec y pedidos al motor geoespacial (quedan guardados en su DB, reutilizados si existen); nueva tarjeta S2b `tools/reference-sectors.mjs`; métrica única en TS validada contra SQL. Rutas del motor verificadas en su código.
- Cámara a 25 m (fixer haiku, sin tests a pedido del director), sin commit en main. Servidores, contenedor db y colima detenidos.
- Mapa: HUD de debug queda encima de las pantallas; labels de landmarks salen como ids en inglés (falta display_name en español en el spec, decisión del director).
- Entrada: una pulsación más corta que un frame se pierde (moveAxis muestrea estado). Considerar cola de eventos si molesta.
- Escala: modelo correcto; Tito se ve ~18 px por cámara a 45 m (pitch 55°, fov 50). Opciones de distancia enviadas al director (25 m ≈ 32 px recomendado). Velocidad caminar 4,2 m/s es trote (decisión de sensación).
- Director pidió commit + PR + merge: se hará en rama `h0-corredor-caminable` cuando CARD-11 (opus) y CARD-12 terminen y pasen validación (cambios de opus mezclados con trabajo aceptado en main.ts/spec.ts/minimap.ts/docs).
- Director eligió opción B (generador híbrido); aprobó Opus para S3/S4, `polygon-clipping`, referencias La Carpio + Santa Ana. Plan detallado en issue #7 (creado a pedido del director). H0 (#1) se aprueba cuando #7 esté jugable.
- Motor geoespacial investigado (Explore; afirmaciones clave verificadas por orquestador: ruta map-data y capas, límite 10 km², proyección local, sin aceras en cross-sections). DB arriba (colima, autorizado): 13 áreas; Panamá solo Santa Ana (=city-core, Acto 2); corredor no importado. Alturas: 49/6796 edificios con height en La Carpio+Santa Ana → hay que resolver alturas al hornear (lógica tipo buildingHeight.ts del motor).
- Propuesta de integración (hornear desde map-data a 1:1, comprimir por selección) enviada al director; espera decisiones.
- Tangente propuesta (no creada): el motor no importa footway/path/steps → callejones y escaleras de barrios informales se pierden. Issue en el backlog del motor.
- Director: ve edificios pero la distribución es básica; espera un resultado similar a su proyecto `geospatial-reconstruction-engine` (importa OSM → PostGIS, grafo vial, calles con sección, cuadras, edificios con altura, parques, cliente 3D). Investigación del motor en curso (Explore) para proponer integración. Sin backend WebGPU roto (director confirma que ve edificios).
