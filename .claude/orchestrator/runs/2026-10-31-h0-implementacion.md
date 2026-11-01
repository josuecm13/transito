# 2026-10-31 — H0 (#1): planear e implementar

Status: implementado, pendiente de aprobación del director al jugarlo.
Goal: H0 jugable, más peatones (pedido del director). Correrlo al final.
Issue: #1

## Decisiones (recomendaciones aceptadas con "planea-implementa")
js-yaml; blockout con semilla en world.yaml; suelo plano; tecla para correr; tests con node:test (sin vitest);
miniplex; peatones añadidos a H0 vía spec (CARD-0).

## Arquitectura
world/ y sim/ puros (guard test) → ecs/ contratos System/GamePlugin → engine/ adaptadores
→ plugins/ features → main.ts = lista de plugins.

## Plan
(Revisado tras CARD-1) [2a ∥ 3] → 2b blockout + grafo de aceras (puro) → 4 world-data + world-view → [5 jugador/cámara/aviso ∥ 6 peatones] → 8 cableado (haiku) → 7 verificación + captura.
Original: CARD-0 spec ∥ CARD-1 andamiaje → CARD-2a mundo puro (spec/coords/geom/slice) ∥ CARD-3 ecs+engine
→ CARD-2b blockout + grafo de aceras → CARD-4 vista del mundo + colisionadores ∥ CARD-6 peatones
→ CARD-5 jugador + cámara + aviso + cableado → CARD-7 verificación + captura.

## Cards
| Card | Agent / model | Outcome | Fix rounds |
|---|---|---|---|
| CARD-0 spec | implementer / sonnet | ok — validador exit 0; 15 mutaciones reportadas, 1 repetida por el orquestador (budget -1 → exit 1, restaurado → exit 0, archivo idéntico) | 0 |
| CARD-1 andamiaje | implementer / sonnet | ok — typecheck/build/test exit 0 (verificado por orquestador); guard mutado con `window` en src/sim → falla, restaurado → pasa | 0 |
| CARD-2a mundo puro | implementer / sonnet | ok — tc 0, 34 tests, sin números del spec en src/world; mutaciones (signo z, clip) reportadas. Parche `loosenFlowClosers` por js-yaml → se reemplaza en 2b | 0 |
| CARD-2b blockout + grafo de aceras | implementer / sonnet | ok — tc/48 tests/build/validador exit 0 (orquestador); world.yaml +1 línea de espacios; 5740 edificios en 45 ms; grafo 10 nodos / 10 aristas / 4 cruces; 3 mutaciones reportadas | 0 |
| CARD-4 world-data/view/physics + cámara | implementer / sonnet | ok — tc/56 tests/build/validador exit 0 (orquestador); captura revisada: suelo, avenida+aceras, cajas, marcador+etiqueta, 55° norte arriba; 5757 colisionadores; spawn mutado (id desconocido / fuera del rect) → exit 1 | 0 |
| CARD-5 jugador + aviso | implementer / sonnet | ok — tc/86 tests/build exit 0 (orquestador); caminar +6.7 m en 2 s headless; colisión: mín 0.397 m a la fachada; aviso visible en tienda / oculto en casa (PNG revisado); 2 mutaciones. Desvío: sin snap-to-ground, gravedad solo en el aire | 0 |
| CARD-8 cableado + h0.png | implementer / haiku | ok — main.ts con 8 plugins; marcador anillo+poste (Tito visible); 6 PNG sueltos borrados; act-1 línea corregida; orquestador: tc/86 tests/build/validador exit 0, h0.png revisado | 0 |
| CARD-6 peatones | implementer / sonnet | ok — 86 tests (orquestador); readouts 36→40/40, maxDist ≤ 154 < 180; LOD físico 4 con foco móvil (?walk=1 del lab); PNG revisado: cápsulas en acera; 3 mutaciones reportadas. Sin test: liberar cuerpos físicos, giro tras bloqueo | 0 |
| CARD-3 ecs + motor + plugins | implementer / sonnet | ok (código) — typecheck 0; sus 3 tests pasan; mutaciones reportadas. Runtime: Chrome headless con virtual-time muestra cielo pero HUD vacío (rAF no avanza en ese modo) → confirmado con CARD-S: HUD `FPS 52 / Entities 0 / Backend WebGL2`, exit 0 | 0 |
| CARD-S captura CDP | implementer / sonnet | ok — orquestador: captura del juego exit 0 con [eval] del HUD; página que lanza error → exit 1 (reportado); sin Chrome residual. Usar --wait ≥ 5000 | 0 |

## Escalations
- js-yaml 5 rechaza world.yaml (`deficient indentation (44:3)`, confirmado por orquestador). Arreglo: 1 línea de espacios en el spec (solo formato) en CARD-2b, se elimina el parche.
- `chrome --screenshot --virtual-time-budget` no sirve para verificar gameplay: el loop no corre. Se crea tools/capture.mjs (CDP, tiempo real).

## Open
- H1: el controlador de Rapier se traba con componente vertical hacia abajo sobre el cuboide de suelo (hipótesis del agente: precisión f32 a ~5 km; no verificada). Las lomas lo necesitan. Técnica candidata: re-centrar el origen de escena en el área activa.
- `tito-home` (5400,2600) coincide con un vértice de corridor-avenue: la casa queda en medio de la calle. Decisión de mapa del director.
- FPS 15–17 en headless (swiftshader, WebGL2): no representativo; medir en navegador real.
- Grafo de aceras pequeño por los datos (solo corridor-avenue con 4 vértices + trozo de coastal-avenue). Más calles = decisión del director tras jugar.
- favicon.ico 404 en consola (cosmético) → CARD-8 cableado.
- act-1.md línea "Fuera de alcance" repite "misiones, diálogos" (redacción del brief). Cosmético.
