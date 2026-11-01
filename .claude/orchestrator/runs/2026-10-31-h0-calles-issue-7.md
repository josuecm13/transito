# Run — #7 Generador realista de calles y cuadras derivadas (H0)

Rama: `issue-7-calles` (desde `main` @ 643c84a, con el cambio de cámara a 25 m sin commit arrastrado).

## Goal
Implementar #7 completo: spec de `street_styles`, métricas de referencia, herramienta de sectores,
generador formal (campo tensorial) e informal (crecimiento orgánico), cuadras/lotes/edificios/uso de
suelo derivados, conexión a `WorldData` y plugins, con realismo medido en pruebas.

## Decisions (director, 2026-10-31)
- "Trabaja de forma autónoma hasta hacerlo realidad" + "sin preguntas, usa opus para un mejor
  resultado" → **todas las tarjetas implementer en Opus**; las decisiones abiertas se toman con la
  propuesta del issue como default y se listan abajo para revisión.
- El orquestador no hace trabajo de infraestructura en línea (levantar el motor geoespacial va en
  una tarjeta). Guardado en memoria.

## Defaults tomados sin preguntar (revisables)
- Banda de realismo = la propuesta del issue (mediana ±35%, p90 ±50%, porcentajes de nodos ±8 pts,
  densidades ±30%; La Carpio más ancha por muestra chica).
- Sectores declarados al inicio: solo La Carpio y Santa Ana (ya importadas). Los sectores de
  San Miguelito / Juan Díaz / Pedregal / Tocumen quedan como sugerencia: el issue dice que los
  recuadros los elige el director.

## Inherited claims checked
- "Todo H0 está sin commit" → **falso**: H0 está mergeado (PR #8, 643c84a). Solo había sin commit la
  cámara a 25 m y una nota del run log.
- Motor geoespacial: API en :58000 no responde, colima detenido (2026-10-31 19:41).

## Plan
S1 (spec) → S2 (street-metrics.ts) → S2b (reference-sectors + motor) → S3 (formal) → S4 (informal)
→ S5 (cuadras/lotes/edificios, ∥ S4 si no se cruzan) → S6 (WorldData + plugins + capturas).

## Cards
| Card | Agent · model | Outcome | Fix rounds |
|---|---|---|---|
| S0 | general-purpose · opus | ok: motor arriba (API :58000 pid 54583, DB :55432, cliente :55173), map-data en /tmp/transito-refs/ | 0 |
| S1 | implementer · opus | ok: street_styles + street-metrics.yaml + validador (6 mutaciones rojo→verde, verificado exit 0 por orquestador) + parser TS | 0 |
| S2 | implementer · opus | ok: paridad exacta con SQL (filter mode), fixtures 57 KB + 340 KB, mutación (grado-2 y dedupe) roja→verde | 0 |

## Hallazgos S0 (verificados en el código del motor)
- Un `POST /import-areas` repetido **vuelve a bajar de Overpass** (import_areas.py:120-128): la herramienta reutiliza
  buscando en `GET /import-areas` por los 4 límites exactos y **no** hace POST si ya existe.
- `map-data?mode=clip` corta segmentos → métricas de red ~2-5% distintas del SQL. `mode=filter` (default) conserva
  segmentos enteros y nodos: usar filter para métricas.
- Santa Ana mide 9,86 km² > límite de 2 km² del issue. Default: el límite aplica a sectores que la herramienta pediría;
  un sector fijado a un `import_area_id` existente queda exento (no se vuelve a importar).
- IDs: La Carpio `6320bab5-c7e1-436d-a7bd-c542ee355cb7`, Santa Ana `df082f58-1e9c-416b-b110-beac5492e128`.

| S2b | implementer · opus | ok: tool + 6 tests con motor falso (mutación rojo→verde), corrida real sin POST, 2ª corrida idéntica (sha 2f47d03) | 0 |
| S3 | implementer · opus | ok: src/world/streets (grafo plano, caras, campo tensorial, streamlines, generate, measure); 166 tests, 17 mutaciones rojo→verde; Costa del Este en banda (9/10 semillas); 88–153 ms | 0 |
| S4 | implementer · opus | ok: crecimiento orgánico; Corredor en banda La Carpio (7/7 métricas semilla 1; 9/10 semillas); 13 tests; ~150 ms warm. Guarda M2 (snap b/c) NO dispara (cubierta por otras reglas) — anotado | 0 |
| S5 | implementer · opus | entregado (buildable/parcels/buildings/land-use/city, polygon-clipping, 5 mutaciones rojo→verde, ~330 ms); **validación: 1 fallo** en tests/city-check.ts:99 (polygon-clipping "Unable to complete output ring") sobre la red que S4 sigue cambiando → fixer opus: falla era solo del checker (arista casi colineal, parcela 4484); producción 0 fallbacks semillas 1–5; checker con reintento en grilla 1 mm + contador `City.stats` + test fallback=0; mutaciones rojo→verde. 11/11 verificado | 1 |
| S6a | implementer · opus | ok: WorldData {streets, city, buildings, walkGraph}; generateBlockout retirado; walkGraph 6.518 nodos / 9.504 aristas / 974 intersecciones con cruces; 3.170 colisionadores en 1 cuerpo (12 ms); buildWorldData ~0,6 s warm; 198 tests verificados | 0 |
| S6b | implementer · opus | ok: street-surface/court-layout puros + tests (mutación rojo→verde); ground en 1 draw call; 10 draws / ~108k tris; 60 FPS (vsync) en M2 Pro WebGPU; 7 capturas en docs/screenshots (revisadas por orquestador) | 0 |
| G1 | implementer · opus | ok: 21→0 calles que penetran (semillas 1–5), islas peatonales enlazadas (4→2 componentes), cul-de-sac con holgura; realismo 10/10 semillas en ambos distritos; 4 mutaciones rojo→verde; 25/25 verificado | 0 |
| SP | implementer · opus | ok: walk_on = [avenue, collector, local, alley] leído por el código; validador/parser/tests; 3 mutaciones rojo→verde; encabezado corregido; references sigue idempotente. Tocó 1 línea fuera de lista (world-data.ts, justificada) | 0 |

## Defaults nuevos de S1 (para revisión del director)
- Campo nuevo `spacing: {collector, local}` en distritos formales (300/70 m Costa del Este, 600/250 m aeropuerto).
- land_use: corredor y Costa del Este 0,06 parque / 0,03 cancha; aeropuerto 0,02 / 0.
- Banda: default 0,35/0,50/0,08/0,30/0,30; override La Carpio 0,45/0,60/0,10.
- Parámetros de crecimiento informal de partida (tramo 40–110 m, ramificación 0,35, snap 15 m, ángulo mín 30°, callejón 0,15).
- S3 asume extracción de caras (cuadras) y bandera de mediana; S5 queda con área edificable, lotes, edificios y uso de suelo.

## Desviación aceptada en S3 (revisable por el director)
- Densidades (intersecciones/km², km/km²) del generado se miden por km² de **celdas del distrito** (mar incluido), no por km² de tierra:
  la referencia usa km² del recuadro (Santa Ana: cuadras cubren 3,62 de 9,86 km², el resto es bahía/bordes). Por tierra, 0/10 semillas
  entran en banda (~1,35× arriba); por celdas, 9/10. Mejor a futuro: congelar también densidades por km² de tierra de la referencia.
- `spacing` de Costa del Este afinado a {collector 420, local 46}.

## Cierre (2026-11-01)
Verificación final del orquestador: typecheck 0, npm test 218/218, build 0, validador 0.
Pendiente para cerrar #7: el director juega y aprueba; medir FPS en su navegador.

Problemas visuales conocidos (S6b + revisión): interiores de cuadra vacíos (solo lotes con frente),
toma de spawn a 25 m es casi todo asfalto, edificios cajas grises, salto duro donde avenida pasa a
colectora, canchas en lotes raros pintan todo el lote.

## Escalations

## Open
- Costa del Este: share de calles sin salida 15,6% (piso de banda 14,5%) — vigilar.
- Walk graph: extremo de calle ancha que termina en T contra calle angosta puede invadir la acera de enfrente (solo resuelto para avenidas). Crecimiento informal siembra desde la autopista (islas se enlazan en limpieza; mejor arreglarlo en la siembra).
- docs/architecture.md menciona `joinTouchingDeadEnds`, que ahora no cambia nada.
- Peatones cruzan la autopista a nivel donde una calle con acera sigue al otro lado (default; pregunta para el director).
- S4: caras grandes ocasionales (13–33 ha) llenas de callejones sin salida en las afueras; tramo medio 50 m vs 93 m de La Carpio (sin banda).
- S4: nuevas perillas informales en código (`GeneratorParams`), no en el spec.
- S5: constantes de lotes/edificios en código; edificios solo rectangulares; 'comercial' = toca avenida.
- docs/architecture.md no menciona src/world/streets (agregar en S6).
- Constantes del generador formal en código (`GeneratorParams`): podrían pasar a world.yaml si el director quiere ajustarlas ahí.
- Limpieza (fixer haiku al final): comentario viejo en street-metrics.yaml:21-22 ("S2b will rewrite… method: sql").
- Ruta `place`+`size_m` de reference-sectors implementada pero sin prueba ni uso en el spec.
- km² de sectores: la herramienta usa área elipsoidal WGS84 (=PostGIS); `bboxKm2` del validador/parser es ~0,4% alto (solo afecta el límite de 2 km²).
