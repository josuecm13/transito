# 2026-10-31 — H1 (#2): investigación de moto y tráfico

Goal: alternativas para moto y tráfico livianos, estilo era PS2. Solo investigación.
Issue: #2

## Recomendación
- Tráfico: grafo de carriles + carros "fantasma" sin física lejos / cuerpos físicos cerca + IDM para el seguimiento; semáforos como función de un reloj global.
- Moto: controlador arcade propio; Rapier solo para colisiones. `DynamicRayCastVehicleController` queda para carros.

## Open
- Datos que le faltan al spec para H1: carriles y cruces (`junctions`), elevación de las lomas, escaleras y callejones.
- Nota técnica `docs/tech/h1-moto-trafico.md` propuesta, sin aprobar.
