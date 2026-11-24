# 2026-11-23 — Mapa: verificación del estado y opciones (solo plan)

**Objetivo:** verificar el traspaso del 2026-11-23 (#12 Pendiente 1 y 2.1 hechos) y proponer opciones
para el siguiente paso del mapa. Sin implementar: se espera la elección del director.

## Estado verificado
- `main` = `origin/main` = `c376cc4`; remoto `github-personal`. `params.ts` borrado; `procedural:` en
  `world.yaml` (líneas 554-703).
- Sin commit: `package.json` (scripts reordenados) **y `src/main.ts`** (la lista de plugins pasó a
  una por línea; mismos 15 plugins, mismo orden). El traspaso no mencionaba `main.ts`.
- `npm run isthmus`: la-ciudad 3.19/3.3, colon 1.07/1.1, balboa 0.69/0.7, el-corredor 1.28/1.3,
  gamboa 0.01/0.1 km²; aeropuerto (5310, 1820), rumbo 5°.
- Huella de `generateIsthmus` (`/tmp/transito-split/fp.ts`) idéntica a `fp-after.txt` en las 11 partes.
- Línea 2, ramal este (3050, 2050) → (5050, 1850), 3373 m, punto medio **(3929, 1070)**: confirmado.
- #12: el último comentario es el estado de Pendiente 1 (dice `origin/main` = `409b16b`, ya viejo);
  no hay comentario para 2.1. #13: comentario de orden de implementación presente.
- Landmarks del Acto 1 (`tito-home` (5400, 2600), `corridor-market` (4600, 2400)) siguen en selva.

## Opciones presentadas
A spec (aeropuerto / pueblos / lago) · B generador (separación verde, islas, canal, tren) ·
C #12 2.2-2.5 tal cual · D #13. Recomendación: A+B1/B2 → 2.2 derivado → 2.3/2.4 → 2.5 → B3/B4 → #13.

## Cartas
Ninguna (corrida de solo plan). Comprobaciones hechas por la sesión principal.

## Abierto
- Elección del director; decisiones abiertas (Línea 2, "line 8", `target_km2` neto, #11, mover el aeropuerto).
- Propuesta de skill: actualizar `references/validation.md` §6 y `verifier` (capturas por agente) contra
  la regla global (los agentes no levantan servidores ni navegadores).
