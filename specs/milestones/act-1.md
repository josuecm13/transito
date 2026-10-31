# Hitos — Acto 1: El barrio

Cada hito termina con algo **jugable y visible** en el navegador. Un hito se cierra cuando el
director lo juega y lo aprueba.

| Hito | Nombre | Resultado jugable | Misiones |
|---|---|---|---|
| **H0** | Corredor caminable | Tito (cápsula) camina por el corredor en bloques grises generado desde `world.yaml`, con cámara cenital; al entrar a la tienda de Doña Mireya aparece un aviso. | — |
| H1 | Moto y tráfico | Subir y bajar de la moto, manejar por las lomas, tráfico simple en las avenidas. | 1.02, 1.04 |
| H2 | Misiones y diálogo | Sistema de misiones con inkjs, dinero, UI de la tienda, marcadores en el mapa. | 1.01, 1.03 |
| H3 | La calle | Nivel de búsqueda y policía, pelea cuerpo a cuerpo, reputación de barrio, NPCs con misiones. | 1.05–1.09 |
| H4 | Noche de lluvia | Clima/lluvia, persecución, escena final, cierre del acto. | 1.10 |
| H5 | Pulido del Acto 1 | Controles táctiles, rendimiento en móvil, guardado. | todas |

## H0 — Criterios de aceptación

- [ ] Proyecto Vite + TypeScript + Three.js + Rapier; `npm run dev`, `npm run typecheck` y
      `npm run build` funcionan.
- [ ] Al cargar, el código lee `specs/map/world.yaml` (sin copiar sus números a mano).
- [ ] Se ve el área del corredor (`tito-corridor`) y la orilla del aeropuerto: suelo, costa según
      `geometry.land`, avenidas según `routes`, y bloques grises como edificios.
- [ ] Los landmarks del corredor (`tito-home`, `corridor-market`, `miguelito-hills`) aparecen
      marcados.
- [ ] Tito es una cápsula con física que camina con WASD/flechas y no atraviesa edificios.
- [ ] La cámara es cenital inclinada (~55°) y sigue a Tito con suavidad.
- [ ] Al acercarse a `corridor-market` aparece en pantalla: "Tienda de Doña Mireya".
- [ ] Hay una captura de pantalla del juego corriendo guardada en `docs/screenshots/h0.png`.

**Fuera de alcance en H0:** moto, tráfico, NPCs, misiones, diálogos, controles táctiles, arte final.
