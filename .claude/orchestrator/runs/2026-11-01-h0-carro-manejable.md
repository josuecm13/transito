# Run — Carro manejable (pedido del director, 2026-11-01)

Rama: `issue-7-calles` (sobre el trabajo sin commit de #7).

## Goal
Un carro estacionado cerca del spawn que Tito aborda con E y maneja (W/S acelera/frena-reversa, A/D gira),
con colisiones contra edificios, peatones y cámara/minimapa siguiéndolo.

## Decisions (director, 2026-11-01)
- Elegido "Carro manejable" frente a tráfico simple / moto / carro estacionado.
- Nota: en el Acto 1 el vehículo de Tito es la moto (H1). El carro queda como prototipo de vehículo; su
  lógica pura (sim/vehicle.ts) puede servir de base para la moto. Decisión del director, registrada.
- Modelo: implementer sonnet (Opus estaba aprobado solo para el run de #7).

## Inherited claims checked
- Al retomar (reinicio de la Mac, carga 35): 4 pruebas de rendimiento en rojo (generateStreets 880 ms /
  cold 4,2 s, deriveCity 1,24 s, buildWorldData 4,1 s). Atribuido a carga; **sin re-verificar en calma**.

## Pedido 2 (director, 2026-11-01)
"Setting para cambiar la cámara a un 3D tradicional y que el mapa también rote dependiendo de la orientación."
Defaults tomados: ajuste "Cámara: Cenital / 3D" en una pantalla Ajustes del menú de pausa, guardado en localStorage;
3D = cámara de persecución detrás del objetivo (Tito o carro), mouse con pointer lock para orbitar y vuelve detrás
del rumbo tras ~1,5 s sin mouse; a pie WASD relativo a la cámara; minimapa rota con el rumbo de la cámara en 3D
(norte arriba en cenital); el mapa general (Tab) sigue con norte arriba.
Tarjeta C2 en cola **después de C1** (ambas tocan pause-menu, player y camera-follow).

## Cards
| Card | Agent · model | Outcome | Fix rounds |
|---|---|---|---|
| C1 | implementer · sonnet | ok: sim/vehicle.ts (13 tests, 10 mutaciones rojo→verde), world/parking.ts (9 tests, 8 mutaciones), plugin vehicle (cinemático + character controller), E subir/bajar, controles en pausa; verificado por orquestador: typecheck 0, 240/240, build 0, captura revisada | 0 |
| C2 | implementer · sonnet | detenido a medias por el director → issue #9; puede haber cambios parciales sin commit | — |

## Open
- ~~Re-correr las 4 pruebas de rendimiento~~ → pasan en calma (240/240): era carga del reinicio.
- C1: sin bordillos, el carro sube a la acera. Choque/giro bloqueado sin prueba automatizada (solo script desechable + capturas).
