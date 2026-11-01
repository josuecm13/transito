# 2026-10-31 — H0 (#1): minimapa + actualización de la skill

Goal: (1) aplicar a la skill orchestrator el formato de log índice + runs/ (aprobado por el director);
(2) agregar un minimapa (pedido del director), spec primero.
Issue: #1
Status: cerrado.

## Decisiones (orquestador, por defecto)
Minimapa circular abajo-izquierda, norte arriba, capa estática pintada una vez a 1.5 m/px + recorte por frame;
landmarks fijados al borde fuera de rango; M alterna 150/400 m; sin peatones; criterio nuevo en act-1.md H0.

## Cards
| Card | Agent / model | Outcome | Fix rounds |
|---|---|---|---|
| SKILL log index | implementer / haiku | ok — diff revisado por orquestador: 3 archivos, 6+/5−, solo las frases indicadas | 0 |
| CARD-9 minimapa | implementer / sonnet | ok — tc/93 tests/build exit 0 (orquestador); PNG zoom revisado: flecha al centro, N, calles, tienda fijada al borde izquierdo; mutación signo y → falla | 0 |
| Recaptura h0.png | verifier / haiku | ok — exit 0, sin pageerror; PNG revisado por orquestador: minimapa, aviso, Tito, anillo | 0 |

## Escalations

## Open
- src/sim/minimap.ts define su propio Vec2 en vez de importar src/world/vec.ts (sim→world está permitido). Duplicación menor; unificar en una limpieza.
